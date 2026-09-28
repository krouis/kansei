/**
 * Content packs.
 *
 * Content ships as versioned packs so the app can state exactly what is
 * installed. The app shell is precached by the service worker; packs are
 * fetched by the installer, verified against SHA-256 digests, and only then
 * marked installed. "Ready offline" is shown only after every required file in
 * every required pack verifies.
 */

export type PackId = string;

export interface PackFile {
  /** Path relative to the pack root. */
  path: string;
  bytes: number;
  sha256: string;
  /** 'data' | 'audio' | 'strokes' | 'font'. */
  kind: 'data' | 'audio' | 'strokes' | 'font';
}

export interface PackManifest {
  id: PackId;
  title: string;
  description: string;
  version: string;
  /** True when the app cannot run its core flows without this pack. */
  required: boolean;
  /** Packs that must be installed first. */
  dependsOn: PackId[];
  totalBytes: number;
  files: PackFile[];
  /** What this pack contains, for the installed-content display. */
  contents: { characters: number; vocab: number; audioClips: number; strokeReferences: number };
  /** Licences and credits that apply to this pack's contents. */
  attributions: PackAttribution[];
}

export interface PackAttribution {
  asset: string;
  source: string;
  url: string;
  license: string;
  licenseUrl: string | null;
  notes: string | null;
}

export interface PackIndex {
  /** Content format version; bumped when the pack schema changes. */
  schemaVersion: number;
  generatedAt: string;
  packs: PackManifest[];
}

export type PackInstallStatus = 'not-installed' | 'partial' | 'verifying' | 'installed' | 'failed';

export interface PackInstallState {
  packId: PackId;
  status: PackInstallStatus;
  /** Files verified present and matching their digest. */
  filesVerified: number;
  filesTotal: number;
  bytesDownloaded: number;
  bytesTotal: number;
  /** Paths still needed, so an interrupted install resumes rather than restarts. */
  pending: string[];
  /** Paths that failed verification, with the reason. */
  failures: Array<{ path: string; reason: string }>;
  installedVersion: string | null;
  lastAttemptAt: string | null;
}

/** What "Ready offline" is allowed to claim. */
export interface OfflineReadiness {
  ready: boolean;
  /** Capabilities that are genuinely available offline right now. */
  capabilities: {
    navigation: boolean;
    hiragana: boolean;
    katakana: boolean;
    kanji: boolean;
    vocabulary: boolean;
    audio: boolean;
    strokeAnimation: boolean;
    handwritingAssessment: boolean;
    aboutAndScience: boolean;
  };
  /** Human-readable list of what is missing, shown instead of a false claim. */
  missing: string[];
}
