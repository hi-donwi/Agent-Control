/** Whether `expiresAt` has already passed `now` (default: the real clock). */
export function isExpired(expiresAt: string, now: number = Date.now()): boolean {
  return now >= new Date(expiresAt).getTime();
}

/** A short, human phrase for how long an approval request has left. */
export function formatExpiry(expiresAt: string, now: number = Date.now()): string {
  if (isExpired(expiresAt, now)) return 'expired';
  const minutes = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  return minutes < 1 ? 'expires in under a minute' : `expires in ${minutes}m`;
}
