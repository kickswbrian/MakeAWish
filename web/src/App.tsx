import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

// The pledge page is what judges open on their phones: keep its first load free of the studio code.
const Studio = lazy(() => import("./screens/Studio.tsx"));
const CampaignRoute = lazy(() => import("./screens/CampaignRoute.tsx"));
const Pledge = lazy(() => import("./screens/Pledge.tsx"));
const Wishlist = lazy(() => import("./screens/Wishlist.tsx"));
const Debug = lazy(() => import("./screens/Debug.tsx"));

export function App() {
  return (
    <Suspense fallback={<div className="boot"><div className="boot-orb" /></div>}>
      <Routes>
        <Route path="/" element={<Studio />} />
        <Route path="/campaign/:id" element={<CampaignRoute />} />
        <Route path="/c/:id" element={<Pledge />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/debug" element={<Debug />} />
        <Route path="*" element={<Studio />} />
      </Routes>
    </Suspense>
  );
}
