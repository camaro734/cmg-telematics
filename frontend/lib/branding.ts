export interface Branding {
  tenant_id: string | null;
  brand_name: string;
  brand_color: string;
  logo_url: string | null;
  is_custom: boolean;
}

export const DEFAULT_BRANDING: Branding = {
  tenant_id: null,
  brand_name: "CMG Telematics",
  brand_color: "#1D9E75",
  logo_url: null,
  is_custom: false,
};

export async function fetchBranding(): Promise<Branding> {
  try {
    const domain =
      typeof window !== "undefined" ? window.location.hostname : "";
    const res = await fetch(`/api/v1/branding?domain=${encodeURIComponent(domain)}`, {
      cache: "no-store",
    });
    if (!res.ok) return DEFAULT_BRANDING;
    return await res.json();
  } catch {
    return DEFAULT_BRANDING;
  }
}
