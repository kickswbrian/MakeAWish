import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type * as THREE from "three";
import { EVENTS, type Campaign, type CampaignUpdatedPayload } from "@wishit/shared";
import Stage from "../three/Stage.tsx";
import { api } from "../lib/api.ts";
import { useRoom, useSocketEvent } from "../lib/socket.ts";
import { fanfare } from "../lib/sound.ts";
import { TopBar } from "../ui/Chrome.tsx";
import { CampaignPanel, Celebration } from "../ui/Campaign.tsx";

/** Laptop view of one campaign: product, live demand bar, QR. Opened from the wishlist. */
export default function CampaignRoute() {
  const { id = "" } = useParams();
  const [c, setC] = useState<Campaign | null>(null);
  const [missing, setMissing] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [confetti, setConfetti] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const gl = useRef<THREE.WebGLRenderer | null>(null);
  const prev = useRef<Campaign["status"] | null>(null);

  useEffect(() => {
    void api.campaign(id).then(setC).catch(() => setMissing(true));
  }, [id]);
  useRoom(`campaign:${id}`);
  useSocketEvent<CampaignUpdatedPayload>(EVENTS.campaignUpdated, (p) => {
    if (p.campaign.id === id) setC(p.campaign);
  });
  useEffect(() => {
    if (!c) return;
    if (prev.current && prev.current !== "funded" && c.status === "funded") {
      setCelebrate((n) => n + 1);
      setConfetti(true);
      fanfare();
      try {
        setSnapshot(gl.current?.domElement.toDataURL("image/png") ?? null);
      } catch {
        /* decoration */
      }
    }
    prev.current = c.status;
  }, [c?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const onGl = useCallback((r: THREE.WebGLRenderer) => {
    gl.current = r;
  }, []);

  return (
    <>
      <div className="stage-bg">
        {c && <Stage spec={c.spec} heroUrl={c.modelUrl} framing="side" celebrateKey={celebrate} onGl={onGl} />}
      </div>
      {confetti && <Celebration onDone={() => setConfetti(false)} />}
      <div className="overlay">
        <TopBar right={<Link to="/wishlist" className="icon-btn" aria-label="Wishlist">☰</Link>} />
        {missing && (
          <div className="wishlist">
            <div className="empty-magic glass">That wish has drifted away. <Link to="/">Make a new one</Link>.</div>
          </div>
        )}
        {c && (
          <div className="campaign-layout">
            <div className="campaign-spacer" />
            <CampaignPanel c={c} snapshot={snapshot} />
          </div>
        )}
      </div>
    </>
  );
}
