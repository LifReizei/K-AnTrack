// plugin.js - AniTrack Pro v2
// Este es el único archivo que Kino cargará.

const API = {
    anilist: "https://graphql.anilist.co",
    mal: "https://api.myanimelist.net/v2"
};

async function updateAniList(token, animeId, episode) {
    const query = `
        mutation ($id: Int, $progress: Int) {
            SaveMediaListEntry (mediaId: $id, progress: $progress) {
                progress
            }
        }
    `;
    const variables = { id: animeId, progress: episode };

    return await kino.fetch(API.anilist, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, variables })
    });
}

// Función principal que Kino llamará al abrir contenido
export async function getInfo(id) {
    // Aquí consultaríamos el estado actual del anime en AniList
    return {
        id: id,
        progress: 0 // Placeholder
    };
}

// Función que Kino llamará cuando el usuario vea un episodio
export async function onProgress(id, episode, settings) {
    const token = settings.anilist_token;
    if (!token) return;

    try {
        await updateAniList(token, id, episode);
        console.log(`Sync OK: ${id} Ep ${episode}`);
    } catch (err) {
        console.error("Error en sync:", err);
    }
}

console.log("AniTrack Pro cargado correctamente.");
