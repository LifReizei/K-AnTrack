const ANILIST_URL = "https://graphql.anilist.co";
const MAL_TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const MAL_API_BASE = "https://api.myanimelist.net/v2";

// El mismo code_verifier/challenge fijo que usamos en el enlace de autorización.
const MAL_CODE_VERIFIER = "A".repeat(128);
const MAL_CLIENT_ID = "TU_CLIENT_ID_MAL"; // <-- Reemplaza con tu Client ID real

// ---------- Utilidades de token ----------

async function exchangeMalCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
    code_verifier: MAL_CODE_VERIFIER,
    client_id: MAL_CLIENT_ID,
    redirect_uri: "urn:ietf:wg:oauth:2.0:oob"
  });

  const res = await kino.fetch(MAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) throw new Error(`MAL token exchange HTTP ${res.status}`);
  const data = await res.json();

  kino.storage.set("mal_access_token", data.access_token);
  kino.storage.set("mal_refresh_token", data.refresh_token);
  kino.storage.set("mal_expires_at", Date.now() + (data.expires_in * 1000));
  // Limpiamos el código usado para que no se reintente.
  kino.storage.set("mal_auth_code_pending", "");
  return data.access_token;
}

async function refreshMalToken() {
  const refreshToken = kino.storage.get("mal_refresh_token");
  if (!refreshToken) throw new Error("No hay refresh_token de MAL");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: MAL_CLIENT_ID
  });

  const res = await kino.fetch(MAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) throw new Error(`MAL refresh HTTP ${res.status}`);
  const data = await res.json();

  kino.storage.set("mal_access_token", data.access_token);
  kino.storage.set("mal_refresh_token", data.refresh_token);
  kino.storage.set("mal_expires_at", Date.now() + (data.expires_in * 1000));
  return data.access_token;
}

async function getValidMalToken() {
  // 1. ¿Hay un código pendiente de canjear?
  const pendingCode = kino.config.get("mal_auth_code") || kino.storage.get("mal_auth_code_pending");
  if (pendingCode && pendingCode.trim() !== "") {
    kino.log("Canjeando código de MAL pendiente...");
    return await exchangeMalCode(pendingCode.trim());
  }

  // 2. ¿Hay un access token guardado y aún válido?
  const accessToken = kino.storage.get("mal_access_token");
  const expiresAt = kino.storage.get("mal_expires_at") || 0;
  if (accessToken && Date.now() < expiresAt - 60000) { // margen de 1 min
    return accessToken;
  }

  // 3. Si expiró, intentamos refrescar.
  if (accessToken || kino.storage.get("mal_refresh_token")) {
    try {
      return await refreshMalToken();
    } catch (e) {
      kino.log(`Refresh de MAL falló: ${e.message}`);
    }
  }

  throw new Error("MyAnimeList no está autenticado. Pega un código en los ajustes.");
}

// ---------- AniList (GraphQL) ----------

async function updateAniList(token, mediaId, progress, status) {
  const query = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
        id progress status
      }
    }
  `;
  const res = await kino.fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables: { mediaId, progress, status } })
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join("; "));
  return json.data;
}

// ---------- MyAnimeList (REST) ----------

async function updateMal(token, malId, progress, status) {
  const body = new URLSearchParams({
    status: status,
    num_watched_episodes: progress
  });
  const res = await kino.fetch(`${MAL_API_BASE}/anime/${malId}/my_list_status`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  if (!res.ok) throw new Error(`MAL update HTTP ${res.status}`);
  return await res.json();
}

// ---------- Tracking principal ----------

export async function track(event) {
  const results = [];
  let anyOk = false;

  // --- AniList ---
  const anilistToken = kino.config.get("anilist_token");
  const anilistId = event.ids?.anilist;
  if (anilistToken && anilistId) {
    try {
      const status = event.finished ? "COMPLETED" : "CURRENT";
      await updateAniList(anilistToken, anilistId, event.progress ?? 0, status);
      results.push({ service: "anilist", ok: true });
      anyOk = true;
    } catch (e) {
      results.push({ service: "anilist", error: e.message });
    }
  }

  // --- MyAnimeList ---
  const malId = event.ids?.mal;
  if (malId) {
    try {
      const malToken = await getValidMalToken();
      const status = event.finished ? "completed" : "watching";
      await updateMal(malToken, malId, event.progress ?? 0, status);
      results.push({ service: "mal", ok: true });
      anyOk = true;
    } catch (e) {
      results.push({ service: "mal", error: e.message });
    }
  }

  if (!anyOk && results.length > 0) {
    throw kino.error("sync_failed", JSON.stringify(results));
  }

  kino.log(JSON.stringify(results));
  return { ok: true };
}