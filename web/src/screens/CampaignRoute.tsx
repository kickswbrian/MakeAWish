import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type * as THREE from "three";
import { EVENTS, type Campaign, type CampaignUpdatedPayload } from "@wishit/shared";
import Stage from "../three/Stage.tsx";
import { api } from "../lib/api.ts";
import { useRoom, useSocketEvent } from "../lib/socket.ts";
import { fanfare } from "../lib/sound.ts";
import { Glows } from "../ui/Chrome.tsx";
import { Bubble, BubbleSparks } from "../ui/Bubble.tsx";
import { BackIcon } from "../ui/Icons.tsx";
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
    <div className="app scrolls wide mode-campaign">
      <Glows />
      {confetti && <Celebration image={snapshot} line={c ? `Funded · ${c.captured || c.held} of ${c.targetBackers}` : undefined} onDone={() => setConfetti(false)} />}
      {c && (
        <div className="orb-slot">
          <BubbleSparks />
          <Bubble>
            <Stage spec={c.spec} heroUrl={c.modelUrl} framing="bubble" transparent orb={false} pedestal={c.spec.category !== "generic" || !!c.modelUrl} celebrateKey={celebrate} onGl={onGl} />
          </Bubble>
        </div>
      )}
      <header className="hdr">
        <Link to="/wishlist" className="cbtn" aria-label="Back to your wishes"><BackIcon /></Link>
      </header>
      {missing && <div className="empty-magic" style={{ marginTop: 24 }}>That wish has drifted away. <Link to="/">Make a new one</Link>.</div>}
      {c && (
        <div className="campaign-body">
          <div className="orb-space" />
          <CampaignPanel c={c} snapshot={snapshot} />
        </div>
      )}
    </div>
  );
}
