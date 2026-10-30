import { useEffect, useState } from "react";
import { Card, Notice, Segmented, Switch } from "@/components/neo";
import { isThemeId, useTheme } from "@/lib/theme";

export function AppearanceSection() {
 const theme = useTheme();
 const [density, setDensity] = useState(document.documentElement.dataset.density ?? "comfortable");
 const [motion, setMotion] = useState(document.documentElement.dataset.reduceMotion === "true");
 const [notice, setNotice] = useState("");
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(timer); }, [notice]);
 function setTheme(value: string) { if (isThemeId(value)) { theme.set(value); setNotice("Theme saved for this browser."); } }
 return <Card id="appearance" title="Appearance" description="Choose a browser theme and adjust this tab's density and motion.">
  <div className="neo-settings-stack">
   {notice && <Notice tone="ok">{notice}</Notice>}
   <div className="neo-settings-row"><div><div>Theme</div><div className="neo-settings-description">The shared Neo design language in dark or light.</div></div><Segmented label="Theme" value={theme.active} onChange={setTheme} options={[{ value: "neo", label: "Dark" }, { value: "neo-light", label: "Light" }]} /></div>
   <div className="neo-settings-row"><div><div>Legacy themes</div><div className="neo-settings-description">Alternative palettes kept from the original deck.</div></div><Segmented label="Legacy themes" value={theme.active} onChange={setTheme} options={[{ value: "paper", label: "Paper" }, { value: "slate", label: "Slate" }, { value: "horizon", label: "Horizon" }]} /></div>
   <div className="neo-settings-row"><div><div>Density</div><div className="neo-settings-description">Compact rows leave more room for settings and tables.</div></div><Segmented label="Density" value={density} onChange={value => { setDensity(value); document.documentElement.dataset.density = value; setNotice("Density applied to this tab."); }} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></div>
   <div className="neo-settings-row"><div><div>Reduce motion</div><div className="neo-settings-description">Disable page transitions and animated controls in this tab.</div></div><Switch label="Reduce motion" checked={motion} onChange={value => { setMotion(value); document.documentElement.dataset.reduceMotion = String(value); setNotice("Motion preference applied to this tab."); }} /></div>
  </div>
 </Card>;
}
