import { fetchUpstreamJsonCached } from './lib/upstream';

const DEFAULT_CONTENTDB_TAGS = [
  { name: 'adventure_and_rpg', title: 'Adventure / RPG' },
  { name: 'building', title: 'Building' },
  { name: 'combat', title: 'Combat' },
  { name: 'Crafting', title: 'Crafting' },
  { name: 'decorative', title: 'Decorative' },
  { name: 'environment', title: 'Environment' },
  { name: 'gui', title: 'GUI' },
  { name: 'hud', title: 'HUD' },
  { name: 'inventory', title: 'Inventory' },
  { name: 'magic', title: 'Magic' },
  { name: 'mapgen', title: 'Mapgen' },
  { name: 'mobs', title: 'Mobs / Animals / NPCs' },
  { name: 'multiplayer', title: 'Multiplayer' },
  { name: 'plants_and_farming', title: 'Plants and Farming' },
  { name: 'player_effects', title: 'Player Effects' },
  { name: 'pve', title: 'PvE' },
  { name: 'pvp', title: 'PvP' },
  { name: 'storage', title: 'Storage' },
  { name: 'survival', title: 'Survival' },
  { name: 'technology', title: 'Technology' },
  { name: 'tools', title: 'Tools / Weapons' },
  { name: 'transport', title: 'Transport' },
  { name: 'world_maintenance', title: 'World Maintenance' }
];

export async function onRequestGet() {
  const upstreamTags = await fetchUpstreamJsonCached<any[]>('/tags/', 3600);

  let tags = DEFAULT_CONTENTDB_TAGS;
  if (Array.isArray(upstreamTags) && upstreamTags.length > 0) {
    tags = upstreamTags
      .map((t: any) => ({
        name: String(t.name || t.id || '').trim(),
        title: String(t.title || t.name || '').trim()
      }))
      .filter((t) => Boolean(t.name && t.title));
  }

  return new Response(JSON.stringify(tags), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=1800, s-maxage=3600'
    }
  });
}
