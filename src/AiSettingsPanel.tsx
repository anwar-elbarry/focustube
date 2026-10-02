import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Icon, icons } from "./Icon";
import {
  AiConfig,
  PROVIDERS,
  ProviderId,
  announceAiConfigChange,
  forgetAi,
  getAiConfig,
  listModels,
  saveAiConfig,
  testAi,
} from "./ai";

type Status = { kind: "idle" | "busy" | "ok" | "error"; text: string };

export default function AiSettingsPanel({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<AiConfig | null>(null);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });

  useEffect(() => {
    getAiConfig()
      .then((c) => {
        setSaved(c);
        const p = (c.provider || "anthropic") as ProviderId;
        setProvider(p);
        setModel(c.model || PROVIDERS.find((x) => x.id === p)!.defaultModel);
        setBaseUrl(c.baseUrl || "http://localhost:11434/v1");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const info = PROVIDERS.find((p) => p.id === provider)!;
  const savedHint = saved?.keyHints[provider];
  const conn = () => ({
    provider,
    model: model.trim(),
    baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
    apiKey: key.trim() ? key.trim() : undefined,
  });

  function switchProvider(p: ProviderId) {
    setProvider(p);
    setKey("");
    setModels([]);
    setStatus({ kind: "idle", text: "" });
    setModel(saved?.provider === p && saved.model ? saved.model : PROVIDERS.find((x) => x.id === p)!.defaultModel);
  }

  async function run(label: string, fn: () => Promise<string>) {
    setStatus({ kind: "busy", text: label });
    try {
      setStatus({ kind: "ok", text: await fn() });
    } catch (e) {
      setStatus({ kind: "error", text: String(e) });
    }
  }

  const loadModels = () =>
    run("Loading models…", async () => {
      const list = await listModels(conn());
      setModels(list);
      if (!model && list.length) setModel(list[0].id);
      return `${list.length} models available`;
    });

  const test = () =>
    run("Testing…", async () => {
      const reply = await testAi(conn());
      return `Connected — the model replied “${reply}”`;
    });

  const save = () =>
    run("Saving…", async () => {
      const c = await saveAiConfig(conn());
      setSaved(c);
      setKey("");
      announceAiConfigChange();
      return "Saved. AI features are ready.";
    });

  const removeKey = () =>
    run("Removing…", async () => {
      const c = await saveAiConfig({ ...conn(), apiKey: "" });
      setSaved(c);
      announceAiConfigChange();
      return "Key removed.";
    });

  const forgetAll = () =>
    run("Removing…", async () => {
      await forgetAi();
      setSaved({ provider: "", model: "", baseUrl: "", keyHints: {} });
      setKey("");
      announceAiConfigChange();
      return "All AI settings and keys were removed from this computer.";
    });

  const needsKey = provider !== "custom";
  const canSave = !!model.trim() && (!needsKey || !!key.trim() || !!savedHint);

  return (
    <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dl-sheet" role="dialog" aria-label="AI settings">
        <header className="dl-head">
          <h2>AI features</h2>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            <Icon d={icons.close} />
          </button>
        </header>

        <div className="dl-body">
          <p className="dl-hint">
            Summaries, questions about a video, and AI-translated captions use <b>your own</b> AI account.
            Without a key, these features stay off and everything else works as usual.
          </p>

          <label className="dl-field">
            <span className="dl-label">Provider</span>
            <select className="dl-select" value={provider} onChange={(e) => switchProvider(e.target.value as ProviderId)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {provider === "custom" && (
            <label className="dl-field">
              <span className="dl-label">Server address</span>
              <div className="bar dl-url">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                />
              </div>
              <span className="dl-hint">Ollama, LM Studio, Groq, Mistral, DeepSeek… anything with an OpenAI-style API.</span>
            </label>
          )}

          <label className="dl-field">
            <span className="dl-label">
              API key
              {info.keyUrl && (
                <button type="button" className="linkbtn accent ai-getkey" onClick={() => open(info.keyUrl!)}>
                  Get a key
                </button>
              )}
            </span>
            <div className="bar dl-url">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={savedHint ? `Saved: ${savedHint} (type to replace)` : info.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {savedHint && !key && (
              <span className="ai-saved">
                <Icon d={icons.check} size={12} /> Key saved on this computer
                <button type="button" className="linkbtn" onClick={removeKey}>
                  Remove
                </button>
              </span>
            )}
          </label>

          <label className="dl-field">
            <span className="dl-label">
              Model
              <button type="button" className="linkbtn accent ai-getkey" onClick={loadModels}>
                Load my models
              </button>
            </span>
            <div className="bar dl-url">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="ai-models"
                placeholder="Choose or type a model id"
                spellCheck={false}
              />
            </div>
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name !== m.id ? m.name : undefined}
                </option>
              ))}
            </datalist>
            <span className="dl-hint">
              Larger models give better summaries; smaller ones are faster and cheaper, which suits translation.
            </span>
          </label>

          {status.text && (
            <p className={`ai-status is-${status.kind}`}>
              {status.kind === "busy" && <span className="spinner tiny" />}
              {status.text}
            </p>
          )}

          <div className="ai-actions">
            <button className="menu-chip" onClick={test} disabled={status.kind === "busy" || !model.trim()}>
              Test connection
            </button>
            <button className="btn-primary" onClick={save} disabled={status.kind === "busy" || !canSave}>
              Save
            </button>
          </div>

          <div className="ai-privacy">
            <b>Privacy.</b> Your key is stored only on this computer and is sent only to the provider you choose. When
            you use an AI feature, the video’s title and transcript are sent to that provider and billed to your
            account.
            {saved?.provider && (
              <button type="button" className="linkbtn" onClick={forgetAll}>
                Remove all AI settings
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
