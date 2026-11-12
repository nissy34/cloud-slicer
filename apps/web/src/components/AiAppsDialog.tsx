import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { CopyCommand } from "../device/ui/BridgeSetup";
import { Dialog } from "./Dialog";

/** The add-on's install files: CI rebuilds them on every change to main under these same links (apps/mcp/pack.mjs). */
const RELEASE = "https://github.com/nissy34/cloud-slicer/releases/download/mcp";
export const MCPB_URL = `${RELEASE}/cloud-slicer.mcpb`;
export const NPX_URL = `${RELEASE}/cloud-slicer-mcp.tgz`;
const README_URL =
  "https://github.com/nissy34/cloud-slicer/blob/main/apps/mcp/README.md";

/** What other chat apps paste into their MCP settings (the usual mcpServers form). */
export const MCP_CONFIG = JSON.stringify(
  { mcpServers: { "cloud-slicer": { command: "npx", args: ["-y", NPX_URL] } } },
  null,
  2,
);

type App = "desktop" | "other";
// Labels are word keys, shown with t().
const APPS: { id: App; label: string }[] = [
  { id: "desktop", label: 'aiApps.claudeDesktop' },
  { id: "other", label: 'aiApps.otherApps' },
];

/**
 * "Use with an AI app": how to install the MCP add-on (apps/mcp) that lets a chat app
 * on the person's computer slice with this site's engines and presets. The same window
 * on every device: a phone can't run it, but can read how and send the link on.
 */
export function AiAppsDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const [app, setApp] = useState<App>("desktop");
  return (
    <Dialog
      title={t('aiApps.title')}
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
            {t('aiApps.more')}
          </a>
          <button className="primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </>
      }
    >
      <div className="ai-apps">
        <p>{t('aiApps.intro')}</p>
        <div
          className="chooser"
          role="radiogroup"
          aria-label={t('aiApps.whichApp')}
        >
          {APPS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={app === a.id}
              className={app === a.id ? "on" : ""}
              onClick={() => setApp(a.id)}
            >
              {t(a.label)}
            </button>
          ))}
        </div>
        {app === "desktop" ? (
          <ol className="ai-apps-steps">
            <li>
              {t('aiApps.step1')}
              <div className="dv-downloads">
                <a
                  className="primary"
                  href={MCPB_URL}
                  data-testid="ai-apps-download"
                >
                  {t('aiApps.download')}
                </a>
                <span className="muted small">{t('aiApps.size')}</span>
              </div>
            </li>
            <li>
              <Trans i18nKey={'aiApps.step2'} components={{ b: <b /> }} />
            </li>
            <li>{t('aiApps.step3')}</li>
          </ol>
        ) : (
          <ol className="ai-apps-steps">
            <li>
              {t('aiApps.otherStep1')}
              <CopyCommand command={MCP_CONFIG} testId="ai-apps-config" />
            </li>
            <li>
              <Trans
                i18nKey={'aiApps.otherStep2'}
                components={{
                  a: (
                    <a
                      href="https://nodejs.org"
                      target="_blank"
                      rel="noreferrer"
                    />
                  ),
                }}
              />
            </li>
          </ol>
        )}
        <p className="muted small">{t('aiApps.canDo')}</p>
      </div>
    </Dialog>
  );
}
