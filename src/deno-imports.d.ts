// Testes em src/ importam regras puras de supabase/functions/_shared. Lá o
// import de tipos usa o especificador do Deno, que o tsc do front não conhece.
declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}
