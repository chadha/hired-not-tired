// Only the candidate ID is kept in the browser session — never CV or profile content.
const KEY = "hnt.candidate";
export const session = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem(KEY)),
  set: (id: string, demo: boolean) => {
    sessionStorage.setItem(KEY, id);
    sessionStorage.setItem(KEY + ".demo", demo ? "1" : "0");
  },
  isDemo: () => typeof window !== "undefined" && sessionStorage.getItem(KEY + ".demo") === "1",
  clear: () => {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY + ".demo");
  },
};