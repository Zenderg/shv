import type { SourceExtensionKind } from '../../../../shared/sourceExtension';
import { DialogBackdrop } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';
import type { DownloadJob } from '../../lib/api';
import {
  SOURCE_EXTENSION_PROTOCOL_VERSION,
  SOURCE_EXTENSION_REQUIRED_VERSION,
  sourceExtensionTargetForOrigin,
  type ExtensionStatus
} from '../../lib/extensionBridge';
import { safeHostname } from '../../utils/format';

export function ExtensionInstallDialog({
  job,
  onCheckAgain,
  onClose,
  sourceExtensionProfile,
  status
}: {
  job: DownloadJob;
  onCheckAgain: () => void;
  onClose: () => void;
  sourceExtensionProfile: SourceExtensionKind;
  status: Exclude<ExtensionStatus, { kind: 'ready' }>;
}) {
  const isOutdated = status.kind === 'outdated';
  const extensionTarget = sourceExtensionTargetForOrigin(window.location.origin, sourceExtensionProfile);
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="extensionDialog">
        <header>
          <div>
            <h2>{isOutdated ? 'Update browser extension' : 'Install browser extension'}</h2>
            <p>{job.titleHint || safeHostname(job.sourceUrl)}</p>
          </div>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <div className="extensionDialogBody">
          <p>
            Source selection now uses a browser extension so the source opens in a real browser tab with a live Sources
            sidebar embedded directly into the source page.
            {' '}
            {isOutdated ? 'Your installed extension is too old for this app build.' : 'The extension was not detected.'}
          </p>
          <p>
            Chrome will ask for broad browser permissions (<code>{'<all_urls>'}</code>, <code>webRequest</code>, and <code>cookies</code>)
            so shv can observe media requests and collect relevant cookies after you click <strong>Use source</strong>.
          </p>
          <div className="extensionVersionBox">
            <span>Required extension</span>
            <strong>v{SOURCE_EXTENSION_REQUIRED_VERSION}</strong>
            <span>Protocol</span>
            <strong>{SOURCE_EXTENSION_PROTOCOL_VERSION}</strong>
            {isOutdated ? (
              <>
                <span>Installed extension</span>
                <strong>v{status.currentVersion}</strong>
              </>
            ) : null}
          </div>
          <ol>
            <li>Download the latest {extensionTarget.kind === 'dev' ? 'development' : 'production'} extension package from this app.</li>
            <li>Unzip it somewhere stable on this machine.</li>
            <li>Open your browser extensions page, enable Developer mode, and choose Load unpacked.</li>
            <li>Select the unzipped <code>{extensionTarget.packagePrefix}</code> folder.</li>
            <li>Return here and click Check again.</li>
          </ol>
          <p className="extensionId">
            Expected extension id: <code>{extensionTarget.id}</code>
          </p>
        </div>
        <footer>
          <a className="downloadButton" href={extensionTarget.downloadPath}>
            Download extension
          </a>
          <button onClick={onCheckAgain} type="button">
            Check again
          </button>
        </footer>
      </section>
    </DialogBackdrop>
  );
}
