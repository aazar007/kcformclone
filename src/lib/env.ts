export function getEnv(key: string): string | undefined {
  return globalThis.process?.env?.[key] as string | undefined;
}
