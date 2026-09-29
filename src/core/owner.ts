/** Extract the logged-in user's numeric id from the value of X's `twid` cookie ("u%3D123" or "u=123"). */
export function ownerIdFromTwid(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const m = /u(?:%3D|=)(\d+)/i.exec(value);
  return m?.[1];
}

/** Extract the profile handle from a href such as "/someone" (the AppTabBar profile link). */
export function handleFromProfileHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(href);
  return m?.[1];
}
