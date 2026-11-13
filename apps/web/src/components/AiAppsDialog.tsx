import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { CopyCommand } from "../device/ui/BridgeSetup";
import { Dialog } from "./Dialog";

/** The add-on's install files: CI rebuilds them on every change to main under these same links (apps/mcp/pack.mjs). */
const RELEASE = "https://github.com/nissy34/cloud-slicer/releases/download/mcp";
export const MCPB_URL = `${RELEASE}/cloud-slicer.mcpb`;
export const NPX_URL = `${RELEASE}/cloud-slicer-mcp.tgz`;
/** The version on the release, from the same CI run that published it (empty on branch previews, which don't publish). */
const VERSION = (import.meta.env.VITE_MCP_VERSION as string | undefined) ?? "";
const README_URL =
  "https://github.com/nissy34/cloud-slicer/blob/main/apps/mcp/README.md";

/** What other chat apps paste into their MCP settings (the usual mcpServers form). */
export const MCP_CONFIG = JSON.stringify(
  { mcpServers: { "cloud-slicer": { command: "npx", args: ["-y", NPX_URL] } } },
  null,
  2,
);

type App = "desktop" | "other";
const APPS: { id: App; label: string }[] = [
  { id: "desktop", label: "Claude Desktop" },
  { id: "other", label: "Other chat apps" },
];

/**
 * "Use with an AI app": how to install the MCP add-on (apps/mcp) that lets a chat app
 * on the person's computer slice with this site's engines and presets. The same window
 * on every device: a phone can't run it, but can read how and send the link on.
 */
export function AiAppsDialog({ onClose }: { onClose(): void }) {
  const [app, setApp] = useState<App>("desktop");
  return (
    <Dialog
      title="Use with an AI app"
      testId="ai-apps-dialog"
      onClose={onClose}
      footer={
        <>
          <a
            className="quiet"
            href={README_URL}
            target="_blank"
            rel="noreferrer"
          >
            More about it
          </a>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="ai-apps">
        <p>
          Ask your AI app to slice for you: “Slice this Benchy for my U1 in PETG
          with 4 walls and tell me the time.” Install it in Claude Desktop as an
          extension, or in other chat apps on your computer such as LM Studio
          and Msty. It slices on your computer with the same engines and presets
          as this site, and your models stay there.
        </p>
        <div className="chooser" role="radiogroup" aria-label="Which app">
          {APPS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={app === a.id}
              className={app === a.id ? "on" : ""}
              onClick={() => setApp(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {app === "desktop" ? (
          <ol className="ai-apps-steps">
            <li>
              Download the Cloud Slicer extension.
              <div className="dv-downloads">
                <a
                  className="secondary"
                  href={MCPB_URL}
                  data-testid="ai-apps-download"
                >
                  <ArrowDownToLine size={16} aria-hidden />
                  Download for Claude Desktop
                </a>
                <span className="muted small" data-testid="ai-apps-version">
                  {VERSION ? `Version ${VERSION} · ` : ""}about 11 MB. Installed
                  already? Download it again to update.
                </span>
              </div>
            </li>
            <li>
              Open the file. Claude Desktop asks to install it: click{" "}
              <b>Install</b>.
            </li>
            <li>Ask Claude to slice a file on your computer.</li>
          </ol>
        ) : (
          <ol className="ai-apps-steps">
            <li>
              In your chat app's settings, add an MCP server with this (most
              apps take it as it is):
              <CopyCommand command={MCP_CONFIG} testId="ai-apps-config" />
            </li>
            <li>
              It needs Node 20 or newer on your computer (
              <a href="https://nodejs.org" target="_blank" rel="noreferrer">
                nodejs.org
              </a>
              ).
            </li>
          </ol>
        )}
        <p className="muted small">
          It can open models and projects, choose the printer, process and
          filaments, set colours and which filament prints each object, change
          settings, arrange plates and slice. While your computer is on, Claude
          on your phone can use it too. Signed in, it also uses your presets and
          printers, and asks you before it starts a print.
        </p>
      </div>
    </Dialog>
  );
}
