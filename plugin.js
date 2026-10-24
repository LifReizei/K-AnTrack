// plugin.js
const ANILIST_URL = "https://graphql.anilist.co";
const MAL_BASE = "https://api.myanimelist.net/v2";

// ---------- Utilidades ----------

async function gqlAniList(token, query, variables) {
  const res = await kino.fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join("; "));
  return json.data;
}

async function patchMAL(accessToken, malId, payload) {
  const res = await kino.fetch(`${MAL_BASE}/anime/${malId}/my_list_status`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(payload).toString()
  });
  if (!res.ok) throw new Error(`MAL HTTP ${res.status}`);
  return await res.json();
}

// ---------- Traducción de estado ----------

function toAniListStatus(event) {
  if (event.finished) return "COMPLETED";
  if (event.progress > 0) return "CURRENT";
  return "PLANNING";
}

function toMALStatus(event) {
  if (event.finished) return "completed";
  if (event.progress > 0) return "watching";
  return "plan_to_watch";
}

// ---------- Función principal ----------

export async function track(event) {
  // event suele traer: { id, kind, progress, finished, ... }
  const cfg = kino.config;

  const syncAniList = cfg.get("sync_anilist") !== false;
  const syncMAL     = cfg.get("sync_mal") !== false;

  if (!syncAniList && !syncMAL) return { skipped: true };

  const results = [];
  let anySuccess = false;

  // --- AniList ---
  if (syncAniList) {
    const token = cfg.get("anilist_token");
    if (!token) {
      results.push({ service: "anilist", error: "missing_token" });
    } else {
      try {
        const aniListId = event.ids?.anilist ?? event.id;
        const status = toAniListStatus(event);
        const query = `
          mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
            SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
              id
              progress
              status
            }
          }
        `;
        await gqlAniList(token, query, {
          mediaId: aniListId,
          progress: event.progress ?? 0,
          status
        });
        anySuccess = true;
        results.push({ service: "anilist", ok: true });
      } catch (e) {
        results.push({ service: "anilist", error: e.message });
      }
    }
  }

  // --- MyAnimeList ---
  if (syncMAL) {
    const accessToken = cfg.get("mal_access_token");
    if (!accessToken) {
      results.push({ service: "mal", error: "missing_token" });
    } else {
      try {
        const malId = event.ids?.mal ?? event.id;
        const payload = {
          status: toMALStatus(event),
          num_watched_episodes: event.progress ?? 0
        };
        await patchMAL(accessToken, malId, payload);
        anySuccess = true;
        results.push({ service: "mal", ok: true });
      } catch (e) {
        results.push({ service: "mal", error: e.message });
      }
    }
  }

  if (!anySuccess) {
    // Si ninguno funcionó, lanzamos un error para que Kino lo registre.
    throw kino.error("sync_failed", JSON.stringify(results));
  }

  // Devolvemos ok; los detalles quedan en el log.
  kino.log(JSON.stringify(results));
  return { ok: true };
}