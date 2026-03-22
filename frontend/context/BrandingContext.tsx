"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { fetchBranding, DEFAULT_BRANDING, type Branding } from "@/lib/branding";

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    fetchBranding().then((b) => {
      setBranding(b);
      // Apply brand color as CSS variable so accent color changes globally
      if (b.is_custom) {
        document.documentElement.style.setProperty("--accent", b.brand_color);
      }
    });
  }, []);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
