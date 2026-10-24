const KEY = "wishit:wishlist";

export interface SavedWish { wishId: string; savedAt: number }

export function loadWishlist(): SavedWish[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveWish(wishId: string) {
  try {
    const list = loadWishlist().filter((w) => w.wishId !== wishId);
    list.unshift({ wishId, savedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* storage unavailable: wishlist is a convenience */
  }
}

export function unsaveWish(wishId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadWishlist().filter((w) => w.wishId !== wishId)));
  } catch {
    /* ignore */
  }
}

export const isSaved = (wishId: string) => loadWishlist().some((w) => w.wishId === wishId);

export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`wishit:${key}`);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: unknown) {
  try {
    localStorage.setItem(`wishit:${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
