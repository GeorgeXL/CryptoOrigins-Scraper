/** Treat only explicit true as locked — avoids truthy strings/objects from APIs. */
export function parseIsLocked(value: unknown): boolean {
  return value === true;
}
