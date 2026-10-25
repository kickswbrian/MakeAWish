/**
 * Back to the very start (the wish screen, same UI): the Wish World shrinks and fades away first.
 * A fresh wish screen, so the page reloads; ?ui= is kept and the intro is skipped.
 */
export function goHome(): void {
  document.querySelector(".world")?.classList.add("world-leaving");
  document.querySelector(".world-hdr")?.classList.add("world-leaving");
  const q = new URLSearchParams(window.location.search);
  q.delete("wish");
  q.set("intro", "0");
  window.setTimeout(() => window.location.assign(`/?${q}`), 520);
}
