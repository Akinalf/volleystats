/* VolleyStats – configuration publique de la synchronisation (Supabase).
 * La clé « publishable » est faite pour être publique : elle ne permet que de LIRE.
 * Toute écriture passe par des fonctions SQL (RPC) qui vérifient le code admin côté serveur :
 *   vs_check_code(code) → boolean
 *   vs_upsert_match(code, match_id, match_data jsonb) → timestamptz
 *   vs_delete_match(code, match_id)
 *   vs_set_kv(code, k, v jsonb)
 * Tables lisibles par tous : matches(id, data, deleted, updated_at), kv(key, value, updated_at). */
window.VS_CONFIG = {
  supabaseUrl: 'https://cpckcsafhvoafopprdvy.supabase.co',
  supabaseKey: 'sb_publishable_jD72g_F_s-PBSCT1XmdawA_v5_mdYXu',
};
