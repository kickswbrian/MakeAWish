import type {
  Campaign, CartesiaTokenResponse, ConfigResponse, MatchesResponse, PledgeResponse, Product, WishDTO, WorldItem,
} from "@wishit/shared";

async function req<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Server errors are { error: { code, message, requestId } }.
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

let configPromise: Promise<ConfigResponse> | null = null;
export const getConfig = () => (configPromise ??= req<ConfigResponse>("GET", "/api/config"));

export const api = {
  createWish: () => req<WishDTO>("POST", "/api/wish"),
  getWish: (id: string) => req<WishDTO>("GET", `/api/wish/${id}`),
  /** Persist the client's product (and optionally a thumbnail data URL). Turns stream via lib/turn.ts. */
  saveProduct: (id: string, product: Product, thumb?: string) => req<{ ok: boolean }>("PUT", `/api/wish/${id}/product`, { product, thumb }),
  transcript: (id: string, user: string, genie: string) => req<{ ok: boolean }>("POST", `/api/wish/${id}/transcript`, { user, genie }),
  lock: (id: string) => req<{ ok: boolean }>("POST", `/api/wish/${id}/lock`),
  matches: (id: string) => req<MatchesResponse>("GET", `/api/wish/${id}/matches`),
  createCampaign: (body: { wishId: string; priceCents: number; targetBackers: number; deadlineAt: number }) =>
    req<Campaign>("POST", "/api/campaigns", body),
  campaign: (id: string) => req<Campaign>("GET", `/api/campaigns/${id}`),
  world: (voter: string, include?: string) => req<WorldItem[]>("GET", `/api/world?voter=${encodeURIComponent(voter)}${include ? `&include=${encodeURIComponent(include)}` : ""}`),
  voteWish: (id: string, voter: string, value: -1 | 0 | 1) =>
    req<{ score: number; up: number; down: number; myVote: -1 | 0 | 1 }>("POST", `/api/wish/${id}/vote`, { voter, value }),
  vote: (id: string, voter: string, up: boolean) => req<Campaign>("POST", `/api/campaigns/${id}/vote`, { voter, up }),
  campaigns: (sort?: "held" | "votes") => req<Campaign[]>("GET", `/api/campaigns${sort ? `?sort=${sort}` : ""}`),
  pledge: (id: string, email: string) => req<PledgeResponse>("POST", `/api/campaigns/${id}/pledges`, { email }),
  pledgeStatus: (id: string) => req<{ id: string; status: string; failReason: string | null }>("GET", `/api/pledges/${id}`),
  mockConfirm: (pledgeId: string, card: string) => req<{ ok: boolean; reason?: string }>("POST", `/api/mock/pledges/${pledgeId}/confirm`, { card }),
  expire: (id: string, token?: string) =>
    req<{ ok: boolean }>("POST", `/api/admin/campaigns/${id}/expire`, undefined, token ? { "x-admin-token": token } : undefined),
  cartesiaToken: () => req<CartesiaTokenResponse>("GET", "/api/cartesia/token"),
  voices: () => req<{ id: string; name: string; description: string }[]>("GET", "/api/cartesia/voices"),
};

export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 });
