"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";

import type { RoleGroup } from "../../lib/roleGroups";

type WalkthroughStep = {
  key: string;
  path: string;
  navTargetId: string;
  targetId: string;
  pageLabel: string;
  title: string;
  description: string;
  validationLabel: string;
};

type OverlayRect = {
  top: number;
  left: number;
  dotTop: number;
  dotLeft: number;
  pointerTop: number;
  pointerLeft: number;
};

type WalkthroughPersistedState = {
  version: string;
  roleGroup: RoleGroup | "unknown";
  done: boolean;
  visible: boolean;
  stepIndex: number;
  validatedKeys: string[];
};

const GLOBAL_WALKTHROUGH_DONE_STORAGE_KEY = "txt.global.walkthrough.done";
const GLOBAL_WALKTHROUGH_INDEX_STORAGE_KEY = "txt.global.walkthrough.index";
const GLOBAL_WALKTHROUGH_VISIBLE_STORAGE_KEY = "txt.global.walkthrough.visible";
const GLOBAL_WALKTHROUGH_VERSION_STORAGE_KEY = "txt.global.walkthrough.version";
const GLOBAL_WALKTHROUGH_STATE_STORAGE_KEY = "txt.global.walkthrough.state.v1";
const GLOBAL_WALKTHROUGH_START_EVENT = "txt-global-walkthrough-start";
const GLOBAL_WALKTHROUGH_VERSION = "3";

function isStoredBoolean(value: string | null): value is "0" | "1" {
  return value === "0" || value === "1";
}

const INTERNAL_STEPS: WalkthroughStep[] = [
  {
    key: "dashboard",
    path: "/dashboard",
    navTargetId: "txt-global-nav-link-dashboard",
    targetId: "global-guide-dashboard-hero",
    pageLabel: "Dashboard",
    title: "Commence par le Dashboard",
    description: "Lis d'abord l'etat global: mode systeme, approvals, exposition et sante generale avant de changer de page.",
    validationLabel: "dashboard lu",
  },
  {
    key: "learn",
    path: "/learn",
    navTargetId: "txt-global-nav-link-learn",
    targetId: "global-guide-learn-hero",
    pageLabel: "Learn",
    title: "Passe par Learn si tu debutes",
    description: "Cette page sert de point d'entree pedagogique pour comprendre vocabulaire, bougies, ordres et logique de la plateforme.",
    validationLabel: "parcours learn compris",
  },
  {
    key: "connectors",
    path: "/connectors",
    navTargetId: "txt-global-nav-link-connectors",
    targetId: "global-guide-connectors-hero",
    pageLabel: "Connectors",
    title: "Verifie l'infrastructure",
    description: "Avant le live, controle ici la sante execution, les comptes raccordes et les capacites broker.",
    validationLabel: "infra validee",
  },
  {
    key: "readiness",
    path: "/live-readiness",
    navTargetId: "txt-global-nav-link-live-readiness",
    targetId: "global-guide-readiness-hero",
    pageLabel: "Readiness",
    title: "Mesure la readiness",
    description: "Cette page te dit si les strategies tiennent encore la route ou si tu dois ralentir avant le live.",
    validationLabel: "readiness verifiee",
  },
  {
    key: "live-ops",
    path: "/live-ops",
    navTargetId: "txt-global-nav-link-live-ops",
    targetId: "global-guide-liveops-hero",
    pageLabel: "Live Ops",
    title: "Pilote les gardes live",
    description: "Live Ops sert a lire les protections systeme, les modes de secours et la posture operateur du desk.",
    validationLabel: "ops lues",
  },
  {
    key: "terminal",
    path: "/terminal",
    navTargetId: "txt-global-nav-link-terminal",
    targetId: "terminal-onboarding",
    pageLabel: "Terminal",
    title: "Entre ensuite dans le Terminal",
    description: "Le terminal reste l'ecran central pour lire, executer et calibrer. Le walkthrough terminal prend ensuite le relai.",
    validationLabel: "terminal ouvert",
  },
  {
    key: "incidents",
    path: "/incidents",
    navTargetId: "txt-global-nav-link-incidents",
    targetId: "global-guide-incidents-hero",
    pageLabel: "Incidents",
    title: "Traite les incidents sans perdre la trace",
    description: "Si quelque chose casse, ce bureau sert a assigner, suivre et cloturer proprement les problemes operateurs.",
    validationLabel: "incident desk compris",
  },
  {
    key: "settings",
    path: "/settings",
    navTargetId: "txt-global-nav-link-settings",
    targetId: "global-guide-settings-hero",
    pageLabel: "Settings",
    title: "Fixe enfin tes preferences",
    description: "Le dernier arret sert a regler le mode novice/expert et les preferences UI globales pour ne plus repartir a zero.",
    validationLabel: "preferences reglees",
  },
];

const CLIENT_STEPS: WalkthroughStep[] = [
  {
    key: "terminal",
    path: "/terminal",
    navTargetId: "txt-global-nav-link-terminal",
    targetId: "terminal-onboarding",
    pageLabel: "Terminal",
    title: "Commence par le Terminal",
    description: "Le terminal est le coeur du parcours client pour lire le marche et executer avec assistance.",
    validationLabel: "terminal ouvert",
  },
  {
    key: "connections",
    path: "/connections",
    navTargetId: "txt-global-nav-link-connections",
    targetId: "global-guide-connections-hero",
    pageLabel: "Connections",
    title: "Raccorde ensuite tes connexions",
    description: "Connections sert a lier brokers, exchanges ou wallets avant de demander du live.",
    validationLabel: "connections lues",
  },
  {
    key: "learn",
    path: "/learn",
    navTargetId: "txt-global-nav-link-learn",
    targetId: "global-guide-learn-hero",
    pageLabel: "Learn",
    title: "Finis par Learn pour monter en autonomie",
    description: "Le parcours Learn reste l'endroit le plus simple pour comprendre ce que chaque ecran fait reellement.",
    validationLabel: "learn valide",
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeValidatedKeys(candidate: string[] | undefined, steps: WalkthroughStep[]): string[] {
  const stepKeys = new Set(steps.map((step) => step.key));
  return Array.from(new Set((candidate || []).filter((key) => stepKeys.has(key))));
}

function buildDefaultPersistedState(steps: WalkthroughStep[], roleGroup: RoleGroup | "unknown", visible = true): WalkthroughPersistedState {
  return {
    version: GLOBAL_WALKTHROUGH_VERSION,
    roleGroup,
    done: false,
    visible,
    stepIndex: 0,
    validatedKeys: [],
  };
}

function normalizePersistedState(
  candidate: Partial<WalkthroughPersistedState> | null | undefined,
  steps: WalkthroughStep[],
  roleGroup: RoleGroup | "unknown",
): WalkthroughPersistedState {
  const validatedKeys = normalizeValidatedKeys(candidate?.validatedKeys, steps);
  const maxIndex = Math.max(steps.length - 1, 0);
  const stepIndex = typeof candidate?.stepIndex === "number" && Number.isFinite(candidate.stepIndex)
    ? clamp(Math.floor(candidate.stepIndex), 0, maxIndex)
    : 0;
  const done = Boolean(candidate?.done) || (steps.length > 0 && validatedKeys.length >= steps.length);
  return {
    version: GLOBAL_WALKTHROUGH_VERSION,
    roleGroup,
    done,
    visible: done ? false : Boolean(candidate?.visible),
    stepIndex: done ? 0 : stepIndex,
    validatedKeys,
  };
}

function readPersistedState(steps: WalkthroughStep[], roleGroup: RoleGroup | "unknown"): WalkthroughPersistedState {
  if (typeof window === "undefined") {
    return buildDefaultPersistedState(steps, roleGroup, false);
  }

  try {
    const rawState = window.localStorage.getItem(GLOBAL_WALKTHROUGH_STATE_STORAGE_KEY);
    if (rawState) {
      const parsed = JSON.parse(rawState) as Partial<WalkthroughPersistedState>;
      if (parsed.version !== GLOBAL_WALKTHROUGH_VERSION || parsed.roleGroup !== roleGroup) {
        return buildDefaultPersistedState(steps, roleGroup, true);
      }
      return normalizePersistedState(parsed, steps, roleGroup);
    }
  } catch {
    // Fall through to legacy keys.
  }

  try {
    const persistedVersion = window.localStorage.getItem(GLOBAL_WALKTHROUGH_VERSION_STORAGE_KEY);
    const persistedDone = window.localStorage.getItem(GLOBAL_WALKTHROUGH_DONE_STORAGE_KEY);
    const persistedVisible = window.localStorage.getItem(GLOBAL_WALKTHROUGH_VISIBLE_STORAGE_KEY);
    const persistedIndexRaw = window.localStorage.getItem(GLOBAL_WALKTHROUGH_INDEX_STORAGE_KEY);
    const hasLegacy = persistedVersion !== null || persistedDone !== null || persistedVisible !== null || persistedIndexRaw !== null;
    if (!hasLegacy) {
      return buildDefaultPersistedState(steps, roleGroup, true);
    }
    if (persistedVersion !== GLOBAL_WALKTHROUGH_VERSION) {
      return buildDefaultPersistedState(steps, roleGroup, true);
    }
    return normalizePersistedState({
      done: persistedDone === "1",
      visible: isStoredBoolean(persistedVisible) ? persistedVisible === "1" : false,
      stepIndex: Number(persistedIndexRaw || "0"),
      validatedKeys: [],
    }, steps, roleGroup);
  } catch {
    return buildDefaultPersistedState(steps, roleGroup, true);
  }
}

function resolveOverlayRect(targetId: string): OverlayRect | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const target = document.getElementById(targetId);
  if (!target) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  const overlayWidth = Math.min(360, Math.max(300, window.innerWidth - 28));
  const dotTop = clamp(rect.top + Math.min(28, rect.height / 2), 18, window.innerHeight - 18);
  const dotLeft = clamp(rect.left + Math.min(28, rect.width / 2), 18, window.innerWidth - 18);
  const placeRight = rect.right + overlayWidth + 28 < window.innerWidth;
  const left = placeRight
    ? Math.min(window.innerWidth - overlayWidth - 12, rect.right + 18)
    : Math.max(12, rect.left - overlayWidth - 18);
  const top = Math.max(12, Math.min(window.innerHeight - 260, rect.top + 8));
  return {
    top,
    left,
    dotTop,
    dotLeft,
    pointerTop: Math.max(16, dotTop - 24),
    pointerLeft: Math.max(16, dotLeft - 22),
  };
}

function buildViewportFallbackRect(): OverlayRect | null {
  if (typeof window === "undefined") {
    return null;
  }
  const overlayWidth = Math.min(360, Math.max(300, window.innerWidth - 28));
  const left = Math.max(12, window.innerWidth - overlayWidth - 16);
  return {
    top: 96,
    left,
    dotTop: 78,
    dotLeft: left + 24,
    pointerTop: 52,
    pointerLeft: left + 6,
  };
}

function resolveOverlayRectWithFallback(targetId: string, fallbackTargetId?: string): OverlayRect | null {
  const directRect = resolveOverlayRect(targetId);
  if (directRect) {
    return directRect;
  }
  if (fallbackTargetId && fallbackTargetId !== targetId) {
    const fallbackRect = resolveOverlayRect(fallbackTargetId);
    if (fallbackRect) {
      return fallbackRect;
    }
  }
  return buildViewportFallbackRect();
}

function overlayRectsEqual(left: OverlayRect | null, right: OverlayRect | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.top === right.top
    && left.left === right.left
    && left.dotTop === right.dotTop
    && left.dotLeft === right.dotLeft
    && left.pointerTop === right.pointerTop
    && left.pointerLeft === right.pointerLeft;
}

export default function GlobalPlatformWalkthrough({ roleGroup = "unknown" }: { roleGroup?: RoleGroup }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [validatedKeys, setValidatedKeys] = useState<string[]>([]);
  const [rect, setRect] = useState<OverlayRect | null>(null);
  const rectRef = useRef<OverlayRect | null>(null);

  const steps = useMemo(() => roleGroup === "client" ? CLIENT_STEPS : INTERNAL_STEPS, [roleGroup]);
  const suppressAutoOpen = pathname === "/terminal";
  const activeStep = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))] || null;
  const routeMatched = Boolean(activeStep && pathname === activeStep.path);
  const currentTargetId = activeStep ? (routeMatched ? activeStep.targetId : activeStep.navTargetId) : "";
  const fallbackTargetId = activeStep?.navTargetId || "";
  const validated = activeStep ? validatedKeys.includes(activeStep.key) && routeMatched : false;

  const persistState = useCallback((next: WalkthroughPersistedState) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(GLOBAL_WALKTHROUGH_STATE_STORAGE_KEY, JSON.stringify(next));
      window.localStorage.setItem(GLOBAL_WALKTHROUGH_VERSION_STORAGE_KEY, GLOBAL_WALKTHROUGH_VERSION);
      window.localStorage.setItem(GLOBAL_WALKTHROUGH_DONE_STORAGE_KEY, next.done ? "1" : "0");
      window.localStorage.setItem(GLOBAL_WALKTHROUGH_VISIBLE_STORAGE_KEY, next.visible ? "1" : "0");
      window.localStorage.setItem(GLOBAL_WALKTHROUGH_INDEX_STORAGE_KEY, String(next.stepIndex));
    } catch {
      // noop
    }
  }, []);

  const focusCurrentTarget = useCallback(() => {
    if (typeof document === "undefined" || !currentTargetId) {
      return;
    }
    const target = document.getElementById(currentTargetId);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentTargetId]);

  const validateCurrentStep = useCallback(() => {
    if (!activeStep || !routeMatched) {
      return;
    }
    setValidatedKeys((current) => current.includes(activeStep.key) ? current : [...current, activeStep.key]);
  }, [activeStep, routeMatched]);

  const restartWalkthrough = useCallback(() => {
    setDone(false);
    setVisible(true);
    setStepIndex(0);
    setValidatedKeys([]);
  }, []);

  const openWalkthrough = useCallback(() => {
    const completed = done || (steps.length > 0 && validatedKeys.length >= steps.length);
    if (completed) {
      restartWalkthrough();
      return;
    }
    setVisible(true);
    window.requestAnimationFrame(() => {
      focusCurrentTarget();
    });
  }, [done, focusCurrentTarget, restartWalkthrough, steps.length, validatedKeys.length]);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/change-password") {
      setLoaded(true);
      setVisible(false);
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    try {
      const persisted = readPersistedState(steps, roleGroup);
      setDone(persisted.done);
      setVisible(suppressAutoOpen ? false : persisted.visible);
      setStepIndex(persisted.stepIndex);
      setValidatedKeys(persisted.validatedKeys);
    } catch {
      setDone(false);
      setVisible(!suppressAutoOpen);
      setStepIndex(0);
      setValidatedKeys([]);
    } finally {
      setLoaded(true);
    }
  }, [pathname, roleGroup, steps, suppressAutoOpen]);

  useEffect(() => {
    const handleRestart = () => {
      openWalkthrough();
    };
    window.addEventListener(GLOBAL_WALKTHROUGH_START_EVENT, handleRestart);
    return () => {
      window.removeEventListener(GLOBAL_WALKTHROUGH_START_EVENT, handleRestart);
    };
  }, [openWalkthrough]);

  useEffect(() => {
    if (!visible || !currentTargetId) {
      rectRef.current = null;
      setRect(null);
      return;
    }
    let retryTimer: number | null = null;
    let observer: MutationObserver | null = null;
    const update = () => {
      const nextRect = resolveOverlayRectWithFallback(currentTargetId, fallbackTargetId);
      if (!overlayRectsEqual(rectRef.current, nextRect)) {
        rectRef.current = nextRect;
        setRect(nextRect);
      }
      if (!nextRect && retryTimer == null) {
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          update();
        }, 120);
      }
    };
    update();
    observer = new MutationObserver(() => {
      update();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [currentTargetId, fallbackTargetId, visible]);

  useEffect(() => {
    if (!visible || !currentTargetId || typeof document === "undefined") {
      return;
    }
    const target = document.getElementById(currentTargetId);
    if (!target) {
      return;
    }
    target.classList.add("txt-global-walkthrough-target");
    if (routeMatched) {
      target.addEventListener("pointerdown", validateCurrentStep, true);
    }
    return () => {
      target.classList.remove("txt-global-walkthrough-target");
      if (routeMatched) {
        target.removeEventListener("pointerdown", validateCurrentStep, true);
      }
    };
  }, [currentTargetId, routeMatched, validateCurrentStep, visible]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    persistState(normalizePersistedState({ done, visible, stepIndex, validatedKeys }, steps, roleGroup));
  }, [done, loaded, persistState, roleGroup, stepIndex, steps, validatedKeys, visible]);

  const handlePause = useCallback(() => {
    setVisible(false);
  }, []);

  const handleOpenCurrentPage = useCallback(() => {
    if (!activeStep) {
      return;
    }
    router.push(activeStep.path);
  }, [activeStep, router]);

  const handleNext = useCallback(() => {
    if (!activeStep || !validated) {
      return;
    }
    if (stepIndex >= steps.length - 1) {
      setDone(true);
      setVisible(false);
      return;
    }
    const nextIndex = stepIndex + 1;
    const nextStep = steps[nextIndex];
    setStepIndex(nextIndex);
    if (pathname !== nextStep.path) {
      router.push(nextStep.path);
      return;
    }
    window.requestAnimationFrame(() => {
      focusCurrentTarget();
    });
  }, [activeStep, focusCurrentTarget, pathname, persistState, router, stepIndex, steps, validated]);

  if (!loaded || !visible || !activeStep || !rect || pathname === "/login" || pathname === "/change-password") {
    return null;
  }

  const overlay = (
    <>
      <div className="txt-global-walkthrough-backdrop" />
      <div className="txt-global-walkthrough-dot" style={{ top: rect.dotTop, left: rect.dotLeft }} />
      <div className="txt-global-walkthrough-pointer" style={{ top: rect.pointerTop, left: rect.pointerLeft }} aria-hidden="true">
        <svg viewBox="0 0 48 48" role="presentation">
          <path d="M9 6L31 25H21L27 42L20 45L14 28L7 35Z" />
        </svg>
      </div>
      <div className="txt-global-walkthrough-card-shell" style={{ top: rect.top, left: rect.left }} role="dialog" aria-label="Walkthrough global TXT">
        <div className="txt-global-walkthrough-card">
          <div className="txt-global-walkthrough-head">
            <div>
              <div className="txt-global-walkthrough-kicker">Walkthrough global</div>
              <div className="txt-global-walkthrough-title">{activeStep.title}</div>
            </div>
            <button type="button" className="txt-global-walkthrough-close" onClick={handlePause} aria-label="Mettre le walkthrough en pause">×</button>
          </div>
          <div className="txt-global-walkthrough-pills">
            <span className="txt-global-walkthrough-pill">etape {Math.min(stepIndex + 1, steps.length)}/{steps.length}</span>
            <span className="txt-global-walkthrough-pill subtle">page {activeStep.pageLabel}</span>
            <span className={`txt-global-walkthrough-pill ${routeMatched ? "good" : "warn"}`}>{routeMatched ? activeStep.validationLabel : "ouvre cette page"}</span>
          </div>
          <p className="txt-global-walkthrough-copy">{activeStep.description}</p>
          <div className={`txt-global-walkthrough-validation ${validated ? "good" : routeMatched ? "warn" : "subtle"}`}>
            {validated
              ? "Etape validee. Passe a la suite."
              : routeMatched
                ? "Clique la zone surlignee ou valide explicitement cette etape avant de continuer."
                : `Tu n'es pas encore sur ${activeStep.pageLabel}. Ouvre d'abord la bonne page.`}
          </div>
          <div className="txt-global-walkthrough-actions">
            <button type="button" className="btn" onClick={focusCurrentTarget}>Pointer la zone</button>
            {!routeMatched ? <button type="button" className="btn" onClick={handleOpenCurrentPage}>Ouvrir {activeStep.pageLabel}</button> : null}
            {routeMatched ? <button type="button" className={`btn${validated ? " btn-primary" : ""}`} onClick={validateCurrentStep}>Valider l'etape</button> : null}
            {stepIndex > 0 || validatedKeys.length > 0 || done ? <button type="button" className="btn" onClick={restartWalkthrough}>Recommencer</button> : null}
            <button type="button" className="btn btn-primary" onClick={handleNext} disabled={!validated}>Suivant</button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}