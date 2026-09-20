import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "../api.js";
import "../../entrypoints/ui.css";

function App() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { void getSettings().then((settings) => setToken(settings.token ?? "")); }, []);
  return <main><header><h1>MilujuFilmy</h1><p>Připojení k lokálnímu backendu</p></header>
    <label>Párovací token<input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label>
    <p>Po spuštění Docker backendu jej najdete v souboru <code>data/pairing-token.txt</code>.</p>
    <button onClick={() => void saveSettings({ token: token.trim() }).then(() => setSaved(true))}>Uložit</button>
    {saved && <p>Uloženo.</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
