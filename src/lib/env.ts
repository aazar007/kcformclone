export function getEnv(key: string): string | undefined {
  // new Function creates code the bundler can't see or replace.
  // At runtime, process.env is populated by nodejs_compat_populate_process_env.
  const get = new Function("key", "return process.env[key]") as (key: string) => string | undefined;
  return get(key);
}
