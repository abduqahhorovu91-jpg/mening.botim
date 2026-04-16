import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import localVideos from "../videos.json";
import hidopImage from "./hidop.png";
import videoOverlayImage from "../video.png/merlin.jpg";
import defaultTrailerVideo from "../video.png/merlin.mp4";

const tg = window.Telegram?.WebApp;
const API_BASE_URL = "";
const DEFAULT_POSTER_URL = "/posters/merlin.jpg";
const DEFAULT_TRAILER_URL = defaultTrailerVideo;
const SINGLE_AD_CLOSE_DELAY_MS = 9000;
const MULTI_AD_CLOSE_DELAY_MS = 4000;
const AD_PREVIEW_REVEAL_DELAY_MS = 3400;
const AD_ROTATE_INTERVAL_MS = 7000;
const TARGET_USER_STORAGE_KEY = "hidop_target_user_id";
const THEME_STORAGE_KEY = "hidop_theme";
const PROFILE_CTA_URL = "https://mee-j52n.onrender.com";
const THEME_OPTIONS = [
  { id: "default", label: "Tungi" },
  { id: "sunset", label: "Sunset" },
  { id: "ocean", label: "Ocean" },
  { id: "forest", label: "Forest" },
  { id: "aurora", label: "Aurora" },
  { id: "horor", label: "Horor" },
];
const THEMES = THEME_OPTIONS.map((theme) => theme.id);
const CATEGORY_TOAST_LABELS = {
  LANDING: "Home",
  LIVE: "live",
  HOME: "kino",
  Pleylist: "pleylist",
  EMPTY: "search",
  PROFILE: "profil",
};

function getTelegramUser(webApp = tg) {
  const directUser = webApp?.initDataUnsafe?.user;
  if (directUser && (directUser.id || directUser.username || directUser.first_name)) {
    return directUser;
  }

  const rawInitData = String(webApp?.initData || "").trim();
  if (!rawInitData) return null;

  try {
    const params = new URLSearchParams(rawInitData);
    const rawUser = params.get("user");
    if (!rawUser) return null;
    const parsedUser = JSON.parse(rawUser);
    return parsedUser && typeof parsedUser === "object" ? parsedUser : null;
  } catch {
    return null;
  }
}

function formatDuration(seconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function normalizeApiUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) return `${API_BASE_URL}${rawUrl}`;
  return `${API_BASE_URL}/${rawUrl.replace(/^\.?\//, "")}`;
}

function isImageLikeUrl(url) {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return false;
  if (/\.(jpg|jpeg|png|webp|gif|avif)(?:[?#].*)?$/.test(value)) return true;
  return value.includes("/poster") || value.includes("/photos/");
}

function isVideoLikeUrl(url) {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return false;
  if (/\.(mp4|webm|mov|m4v)(?:[?#].*)?$/.test(value)) return true;
  return value.includes("/trailer") || value.includes("/play") || value.includes("/videos/");
}

function buildVideoFileUrl(itemId) {
  return `${API_BASE_URL}/api/video/${encodeURIComponent(itemId)}/play`;
}

function buildLiveEmbedUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return "";
  try {
    const parsedUrl = new URL(rawUrl, window.location.origin);
    const host = parsedUrl.hostname.toLowerCase();
    let embedUrl = parsedUrl;

    if (host.includes("youtu.be")) {
      const videoId = parsedUrl.pathname.replace(/^\/+/, "").split("/")[0];
      if (videoId) {
        embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
      }
    } else if (host.includes("youtube.com")) {
      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      if (parts[0] === "watch") {
        const videoId = parsedUrl.searchParams.get("v");
        if (videoId) {
          embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
        }
      } else if (parts[0] === "live" && parts[1]) {
        embedUrl = new URL(`https://www.youtube.com/embed/${parts[1]}`);
      } else if (parts[0] === "embed" && parts[1]) {
        embedUrl = new URL(`https://www.youtube.com/embed/${parts[1]}`);
      }
    }

    embedUrl.searchParams.set("enablejsapi", "1");
    embedUrl.searchParams.set("playsinline", "1");
    embedUrl.searchParams.set("autoplay", "1");
    if (window.location.origin) {
      embedUrl.searchParams.set("origin", window.location.origin);
    }
    return embedUrl.toString();
  } catch {
    return rawUrl;
  }
}

function getPosterUrl(item) {
  const explicitPosterUrl = String(item?.poster_url || "").trim();
  if (explicitPosterUrl && isImageLikeUrl(explicitPosterUrl)) {
    return normalizeApiUrl(explicitPosterUrl);
  }
  const posterProxyUrl = String(item?.poster_proxy_url || "").trim();
  if (posterProxyUrl) {
    return normalizeApiUrl(posterProxyUrl);
  }
  const previewPosterUrl = String(item?.preview_url || "").trim();
  if (previewPosterUrl && isImageLikeUrl(previewPosterUrl)) {
    return normalizeApiUrl(previewPosterUrl);
  }
  return DEFAULT_POSTER_URL;
}

function getTrailerUrl(item) {
  const title = String(item?.title || "").trim().toLowerCase();
  const explicitTrailerUrl = String(item?.trailer_url || "").trim();

  // Merlin qismlari uchun lokal treylerni majburan ishlatamiz.
  if (title.includes("merlin")) {
    return DEFAULT_TRAILER_URL;
  }

  if (explicitTrailerUrl && isVideoLikeUrl(explicitTrailerUrl)) {
    return normalizeApiUrl(explicitTrailerUrl);
  }
  const trailerProxyUrl = String(item?.trailer_proxy_url || "").trim();
  if (trailerProxyUrl) {
    return normalizeApiUrl(trailerProxyUrl);
  }
  const streamUrl = String(item?.stream_url || "").trim();
  if (streamUrl && isVideoLikeUrl(streamUrl)) {
    return normalizeApiUrl(streamUrl);
  }
  const previewVideoUrl = String(item?.preview_url || "").trim();
  if (previewVideoUrl && isVideoLikeUrl(previewVideoUrl)) {
    return normalizeApiUrl(previewVideoUrl);
  }
  return DEFAULT_TRAILER_URL;
}

function detectCategory(item) {
  const haystack = `${item.title || ""} ${item.comment || ""}`.toLowerCase();
  if (
    haystack.includes("tiktok") ||
    haystack.includes("instagram") ||
    haystack.includes("youtube") ||
    haystack.includes("youtu") ||
    haystack.includes("ombor") ||
    haystack.includes("pleylist")
  ) {
    return "Pleylist";
  }
  return "HOME";
}

function detectPalette(item) {
  return detectCategory(item) === "Pleylist" ? "instagram" : "night";
}

function getDisplayTitle(item) {
  return item?.saved_name || item?.title || "Sarlavha topilmadi";
}

function getDisplayDescription(item) {
  return item?.comment || item?.category || "Video tafsilotlari mavjud emas";
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEpisodeNumber(value) {
  const text = normalizeSearchText(value);
  const episodePatterns = [
    /(\d+)\s*-\s*qism\b/,
    /(\d+)\s*qism\b/,
    /\bqism\s*(\d+)\b/,
    /\bpart\s*(\d+)\b/,
    /\bep(?:isode)?\s*(\d+)\b/,
  ];

  for (const pattern of episodePatterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  const trailingNumber = text.match(/(\d+)(?!.*\d)/);
  return trailingNumber ? Number(trailingNumber[1]) : Number.POSITIVE_INFINITY;
}

function getTitleBase(value) {
  return normalizeSearchText(value)
    .replace(/\b\d+\s*-\s*qism\b/g, "")
    .replace(/\b\d+\s*qism\b/g, "")
    .replace(/\bqism\s*\d+\b/g, "")
    .replace(/\bpart\s*\d+\b/g, "")
    .replace(/\bep(?:isode)?\s*\d+\b/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getInitials(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "U";
  const parts = normalized.split(/\s+/).filter(Boolean);
  const joined = parts
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("");
  return (joined || normalized.slice(0, 1)).toUpperCase();
}

function getTelegramUserId(webApp = tg) {
  const telegramUser = getTelegramUser(webApp);
  const rawUserId = telegramUser?.id;
  if (typeof rawUserId === "number" && Number.isFinite(rawUserId) && rawUserId > 0) {
    return String(rawUserId);
  }
  if (typeof rawUserId === "string" && /^\d+$/.test(rawUserId.trim())) {
    return rawUserId.trim();
  }
  return "";
}

function normalizeAdItems(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .filter((item) => item && typeof item === "object" && item.enabled !== false)
    .map((item, index) => ({
      id: String(item.id || index + 1),
      enabled: item.enabled !== false,
      videoUrl: normalizeApiUrl(item.video_url),
      linkUrl: String(item.link_url || "").trim(),
      caption: String(item.caption || "").trim(),
    }))
    .filter((item) => item.videoUrl);

  if (items.length) return items;

  if (payload?.enabled && payload?.video_url) {
    return [
      {
        id: "legacy",
        enabled: true,
        videoUrl: normalizeApiUrl(payload.video_url),
        linkUrl: String(payload.link_url || "").trim(),
        caption: String(payload.caption || "").trim(),
      },
    ];
  }

  return [];
}

function getTargetUserStorageKey(userId) {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId
    ? `${TARGET_USER_STORAGE_KEY}:${normalizedUserId}`
    : `${TARGET_USER_STORAGE_KEY}:guest`;
}

function createViewerId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `viewer-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function getAdCloseDelayMs(adCount) {
  return Number(adCount || 0) <= 1 ? SINGLE_AD_CLOSE_DELAY_MS : MULTI_AD_CLOSE_DELAY_MS;
}

function getThemeStorageKey(userId) {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId ? `${THEME_STORAGE_KEY}:${normalizedUserId}` : THEME_STORAGE_KEY;
}

function getSearchScore(item, activeQuery) {
  const query = activeQuery.trim();
  if (!query) return 0;
  const normalizedQuery = query.toLowerCase();

  const title = String(item.title || "").toLowerCase().trim();
  const comment = String(item.comment || "").toLowerCase().trim();
  const category = String(item.category || "").toLowerCase().trim();
  const idText = String(item.id ?? "").toLowerCase().trim();

  if (/^\d+$/.test(normalizedQuery)) {
    return idText === normalizedQuery ? 2000 : -1;
  }

  if (title === normalizedQuery) return 1000;
  if (idText === normalizedQuery) return 950;
  if (title.startsWith(normalizedQuery)) return 900 - Math.min(title.length, 200);

  const titleWords = title.split(/\s+/).filter(Boolean);
  if (titleWords.some((word) => word.startsWith(normalizedQuery))) return 820;

  if (comment.startsWith(normalizedQuery) || category.startsWith(normalizedQuery)) return 760;
  if (title.includes(normalizedQuery)) return 680;
  if (comment.includes(normalizedQuery) || category.includes(normalizedQuery)) return 560;
  if (idText.includes(normalizedQuery)) return 520;

  return 0;
}

function matchesSearch(item, activeQuery) {
  const query = activeQuery.trim();
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  const idText = String(item.id ?? "").toLowerCase().trim();

  if (/^\d+$/.test(normalizedQuery)) {
    return idText === normalizedQuery;
  }

  const fields = [
    String(item.title || "").toLowerCase(),
    String(item.comment || "").toLowerCase(),
    String(item.category || "").toLowerCase(),
    idText,
  ];
  const haystack = fields.join(" ");
  if (haystack.includes(normalizedQuery)) return true;

  const words = fields
    .flatMap((field) => field.split(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/i))
    .filter(Boolean);

  if (words.some((word) => word.startsWith(normalizedQuery))) return true;
  if (normalizedQuery.length <= 2) {
    return words.some((word) => word[0] === normalizedQuery[0]);
  }
  return false;
}

function sortBySearchRelevance(items, activeQuery) {
  const naturalCollator = new Intl.Collator("uz", {
    numeric: true,
    sensitivity: "base",
  });

  return items.slice().sort((left, right) => {
    const scoreDiff = getSearchScore(right, activeQuery) - getSearchScore(left, activeQuery);
    if (scoreDiff !== 0) return scoreDiff;

    if (!activeQuery) {
      const leftAddedAt = Date.parse(left.added_at || "") || 0;
      const rightAddedAt = Date.parse(right.added_at || "") || 0;
      const addedAtDiff = rightAddedAt - leftAddedAt;
      if (addedAtDiff !== 0) return addedAtDiff;

      const idDiff = Number(right.id || 0) - Number(left.id || 0);
      if (idDiff !== 0) return idDiff;
    }

    const leftTitle = normalizeSearchText(left.saved_name || left.title || "");
    const rightTitle = normalizeSearchText(right.saved_name || right.title || "");
    const leftBase = getTitleBase(leftTitle);
    const rightBase = getTitleBase(rightTitle);

    if (activeQuery) {
      const leftBaseStarts = leftBase.startsWith(activeQuery);
      const rightBaseStarts = rightBase.startsWith(activeQuery);
      if (leftBaseStarts !== rightBaseStarts) return rightBaseStarts - leftBaseStarts;
    }

    const baseDiff = leftBase.localeCompare(rightBase);
    if (baseDiff !== 0) return baseDiff;

    const leftEpisode = extractEpisodeNumber(leftTitle);
    const rightEpisode = extractEpisodeNumber(rightTitle);
    const leftEpisodeRank = Number.isFinite(leftEpisode) ? leftEpisode : Number.MAX_SAFE_INTEGER;
    const rightEpisodeRank = Number.isFinite(rightEpisode) ? rightEpisode : Number.MAX_SAFE_INTEGER;
    const episodeDiff = leftEpisodeRank - rightEpisodeRank;
    if (episodeDiff !== 0) return episodeDiff;

    const titleDiff = naturalCollator.compare(leftTitle, rightTitle);
    if (titleDiff !== 0) return titleDiff;

    return Number(left.id || 0) - Number(right.id || 0);
  });
}

function ScrollingText({ text, className }) {
  return (
    <span className={className}>
      <span>{text}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

function Avatar({ className, photoUrl, fallbackText, alt = "Profil rasmi" }) {
  const normalizedPhotoUrl = String(photoUrl || "").trim();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
  }, [normalizedPhotoUrl]);

  if (!normalizedPhotoUrl) {
    return <span className={className}>{fallbackText}</span>;
  }

  return (
    <span className={`${className} has-photo ${isLoaded ? "is-loaded" : "is-loading"}`}>
      <span className="profile-avatar-fallback" aria-hidden={isLoaded ? "true" : "false"}>
        {fallbackText}
      </span>
      <img
        className="profile-avatar-image"
        src={normalizedPhotoUrl}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(false)}
      />
    </span>
  );
}

function normalizeVideoItem(item) {
  return {
    ...item,
    id: Number(item.id || 0),
    title: item.title || "Sarlavha topilmadi",
    comment: item.comment || "",
    category: item.category || detectCategory(item),
    duration: Number(item.duration || 0),
    ageLabel: item.ageLabel || "Kutubxonada",
    palette: item.palette || detectPalette(item),
    preview_url: normalizeApiUrl(item.preview_url),
    poster_url: getPosterUrl(item),
    trailer_url: getTrailerUrl(item),
    stream_url: normalizeApiUrl(item.stream_url || (item.id ? buildVideoFileUrl(item.id) : "")),
    poster_proxy_url: normalizeApiUrl(item.poster_proxy_url),
    trailer_proxy_url: normalizeApiUrl(item.trailer_proxy_url),
    added_at: item.added_at || "",
    web_streamable: typeof item.web_streamable === "boolean" ? item.web_streamable : null,
    web_stream_error: item.web_stream_error || "",
    web_stream_message: item.web_stream_message || "",
    web_stream_source: item.web_stream_source || "",
    file_size: Number(item.file_size || 0),
  };
}

function getLocalCatalogItems() {
  const items = Array.isArray(localVideos?.items) ? localVideos.items : [];
  return items.map(normalizeVideoItem);
}

async function loadCatalogItems() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/catalog`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) {
      return getLocalCatalogItems();
    }
    return items.map(normalizeVideoItem);
  } catch (error) {
    console.error("Failed to load videos:", error);
    return getLocalCatalogItems();
  }
}

export default function App() {
  const [telegramUserId, setTelegramUserId] = useState(() => getTelegramUserId());
  const [telegramUser, setTelegramUser] = useState(() => getTelegramUser());
  const [playIntroAnimations, setPlayIntroAnimations] = useState(true);
  const [theme, setTheme] = useState("default");
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState([]);
  const [savedItems, setSavedItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState("LANDING");
  const [activeQuery, setActiveQuery] = useState("");
  const [selectedTargetUserId, setSelectedTargetUserId] = useState("");
  const [isAutoDetectedUserId, setIsAutoDetectedUserId] = useState(false);
  const [telegramProfilePhotoUrl, setTelegramProfilePhotoUrl] = useState("");
  const [sharedProfileUsers, setSharedProfileUsers] = useState([]);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileInputValue, setProfileInputValue] = useState("");
  const [profileDetails, setProfileDetails] = useState({});
  const [remoteProfileName, setRemoteProfileName] = useState("");
  const [topToastMessage, setTopToastMessage] = useState("");
  const [soonBadgeVisible, setSoonBadgeVisible] = useState(false);
  const [liveBadgeVisible, setLiveBadgeVisible] = useState(false);
  const [liveCurrentItem, setLiveCurrentItem] = useState(null);
  const [liveEntryRequested, setLiveEntryRequested] = useState(false);
  const [liveStreamStatus, setLiveStreamStatus] = useState("Jonli efir hali boshlanmagan.");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageItems, setMessageItems] = useState([]);
  const [liveMessageDraft, setLiveMessageDraft] = useState("");
  const [liveMessageItems, setLiveMessageItems] = useState([]);
  const [messagePreviewUser, setMessagePreviewUser] = useState(null);
  const [adItems, setAdItems] = useState([]);
  const [adIndex, setAdIndex] = useState(0);
  const [adOverlayOpen, setAdOverlayOpen] = useState(false);
  const [adOverlayIndex, setAdOverlayIndex] = useState(0);
  const [adOverlayStartIndex, setAdOverlayStartIndex] = useState(0);
  const [adCloseReady, setAdCloseReady] = useState(false);
  const [adCloseCountdown, setAdCloseCountdown] = useState(Math.ceil(SINGLE_AD_CLOSE_DELAY_MS / 1000));
  const [adPreviewVisible, setAdPreviewVisible] = useState(false);
  const [pendingAdSendItem, setPendingAdSendItem] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const [modalVideoUrl, setModalVideoUrl] = useState("");
  const [modalVideoReady, setModalVideoReady] = useState(false);
  const [modalVideoMessage, setModalVideoMessage] = useState("Video tayyorlanmoqda...");
  const [modalReactionState, setModalReactionState] = useState({
    likes: 0,
    dislikes: 0,
    user_reaction: null,
  });
  const modalVideoRef = useRef(null);
  const videoStatusCacheRef = useRef(new Map());
  const topToastTimerRef = useRef(null);
  const soonBadgeTimerRef = useRef(null);
  const categoryToastReadyRef = useRef(false);
  const refreshIntervalRef = useRef(null);
  const catalogRefreshInFlightRef = useRef(false);
  const selectedTargetUserIdRef = useRef("");
  const profileInputRef = useRef(null);
  const holoInputRef = useRef(null);
  const pendingSendVideoIdsRef = useRef(new Set());
  const messageThreadRef = useRef(null);
  const liveMessageThreadRef = useRef(null);
  const adTimerRef = useRef(null);
  const adCountdownIntervalRef = useRef(null);
  const liveFrameRef = useRef(null);

  selectedTargetUserIdRef.current = selectedTargetUserId;

  const photoUrl = String(
    telegramProfilePhotoUrl || telegramUser?.photo_url || "",
  ).trim();
  const profileBadgeText = (() => {
    const firstName = String(telegramUser?.first_name || "").trim();
    if (selectedTargetUserId) return selectedTargetUserId.slice(-2);
    if (firstName) return firstName.slice(0, 1).toUpperCase();
    return "U";
  })();
  const telegramFullName = [
    String(telegramUser?.first_name || "").trim(),
    String(telegramUser?.last_name || "").trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const storedProfileName = String(
    profileDetails?.display_name || profileDetails?.full_name || profileDetails?.username || "",
  ).trim();
  const profileDisplayName =
    telegramFullName ||
    remoteProfileName ||
    storedProfileName ||
    (selectedTargetUserId ? `ID ${selectedTargetUserId}` : "HIDOP BOT User");
  const activeOwnerId = selectedTargetUserId || telegramUserId || "";
  const themeStorageKey = getThemeStorageKey(telegramUserId || "guest");
  const targetUserStorageKey = getTargetUserStorageKey(telegramUserId || "guest");
  const deferredQuery = useDeferredValue(activeQuery);
  const liveEmbedUrl = buildLiveEmbedUrl(liveCurrentItem?.embed_url);
  const liveSessionKey = liveCurrentItem?.id || liveCurrentItem?.embed_url || "";
  const liveIsReady = Boolean(liveCurrentItem?.embed_url);
  const liveIsPlaying = activeCategory === "LIVE" && liveIsReady && liveEntryRequested;
  const currentAd = adItems.length ? adItems[((adIndex % adItems.length) + adItems.length) % adItems.length] : null;
  const overlayAds = adItems.length
    ? [...adItems.slice(adOverlayStartIndex), ...adItems.slice(0, adOverlayStartIndex)]
    : [];
  const currentOverlayAd = overlayAds.length ? overlayAds[Math.min(adOverlayIndex, overlayAds.length - 1)] : null;
  const isOverlayMultiAd = overlayAds.length > 1;
  const isOverlayLastAd = !overlayAds.length || adOverlayIndex >= overlayAds.length - 1;
  const hasActiveAd = Boolean(currentAd?.videoUrl);
  const adCloseDelayMs = getAdCloseDelayMs(overlayAds.length || adItems.length);

  function sendLiveFrameCommand(command) {
    const frameWindow = liveFrameRef.current?.contentWindow;
    if (!frameWindow || !liveEmbedUrl || !liveIsPlaying) return;
    frameWindow.postMessage(
      JSON.stringify({
        event: "command",
        func: command,
        args: [],
      }),
      "*",
    );
  }

  const visibleSourceItems =
    activeCategory === "LANDING" || activeCategory === "LIVE" || activeCategory === "MESSAGE" || activeCategory === "PROFILE"
      ? []
      : activeCategory === "EMPTY"
        ? deferredQuery.trim()
          ? catalogItems
          : []
        : activeCategory === "Pleylist"
          ? savedItems
          : catalogItems;
  const filteredItems = sortBySearchRelevance(
    visibleSourceItems.filter((item) => matchesSearch(item, deferredQuery)),
    deferredQuery,
  );

  const showCatalogChrome =
    !((activeCategory === "LANDING" || activeCategory === "LIVE" || activeCategory === "MESSAGE" || activeCategory === "EMPTY") && !activeQuery) &&
    activeCategory !== "PROFILE";
  const showEmptyState = !(
    (activeCategory === "LANDING" || activeCategory === "LIVE" || activeCategory === "MESSAGE" || activeCategory === "EMPTY" || activeCategory === "PROFILE") &&
    !activeQuery
  );

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#101725");
      tg.setBackgroundColor("#101725");
    }

    let attempts = 0;
    const syncTelegramUser = () => {
      const nextUser = getTelegramUser();
      const nextUserId = getTelegramUserId();
      if (!nextUserId) return false;
      setTelegramUser((current) => {
        const currentId = String(current?.id || "").trim();
        return currentId === nextUserId ? current : nextUser;
      });
      setTelegramUserId((current) => (current === nextUserId ? current : nextUserId));
      return true;
    };

    if (syncTelegramUser()) return undefined;

    const intervalId = window.setInterval(() => {
      attempts += 1;
      if (syncTelegramUser() || attempts >= 12) {
        window.clearInterval(intervalId);
      }
    }, 500);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!telegramUserId) return;

    fetch(`${API_BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: telegramUserId,
        username: String(telegramUser?.username || "").trim(),
        full_name: [
          String(telegramUser?.first_name || "").trim(),
          String(telegramUser?.last_name || "").trim(),
        ].filter(Boolean).join(" "),
        photo_url: String(telegramUser?.photo_url || "").trim(),
      }),
    }).catch(() => {});
  }, [telegramUserId, telegramUser]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(themeStorageKey) || "default";
    setTheme(THEMES.includes(savedTheme) ? savedTheme : "default");

    if (telegramUserId) {
      setSelectedTargetUserId(telegramUserId);
      setProfileInputValue(telegramUserId);
      setIsAutoDetectedUserId(true);
      window.localStorage.removeItem(TARGET_USER_STORAGE_KEY);
    } else if (!tg) {
      const savedTarget = window.localStorage.getItem(targetUserStorageKey) || "";
      const normalizedTarget = /^\d+$/.test(savedTarget) ? savedTarget : "";
      setSelectedTargetUserId(normalizedTarget);
      setProfileInputValue(normalizedTarget);
      setIsAutoDetectedUserId(false);
    } else {
      setSelectedTargetUserId("");
      setProfileInputValue("");
      setIsAutoDetectedUserId(true);
    }
  }, [telegramUserId, themeStorageKey, targetUserStorageKey]);

  useEffect(() => {
    document.body.dataset.theme = THEMES.includes(theme) ? theme : "default";
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme, themeStorageKey]);

  useEffect(() => {
    const loadLiveCurrent = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/live-current`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) return;
        setLiveCurrentItem(payload.item || null);
        if (!payload.item) {
          setLiveStreamStatus("Jonli efir hali boshlanmagan.");
          return;
        }
        setLiveStreamStatus("YouTube live tayyor.");
      } catch {
        return;
      }
    };

    loadLiveCurrent();
    const intervalId = window.setInterval(loadLiveCurrent, 2000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setLiveEntryRequested(false);
  }, [liveSessionKey]);

  useEffect(() => {
    if (activeCategory !== "LIVE") {
      setLiveEntryRequested(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    const loadLiveMessages = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/live-messages?limit=45`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || !Array.isArray(payload.items)) return;
        setLiveMessageItems(payload.items);
      } catch {
        return;
      }
    };

    loadLiveMessages();
    const intervalId = window.setInterval(loadLiveMessages, 1500);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/chat-messages?limit=45`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || !Array.isArray(payload.items)) return;
        setMessageItems(payload.items);
      } catch {
        return;
      }
    };

    loadMessages();
    const intervalId = window.setInterval(loadMessages, 1500);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    document.body.dataset.category = activeCategory.toLowerCase();
  }, [activeCategory]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setPlayIntroAnimations(false);
    }, 2800);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (!categoryToastReadyRef.current) {
      categoryToastReadyRef.current = true;
      return;
    }
    if (activeCategory === "LIVE") {
      setTopToastMessage("");
      return;
    }
    showTopToast(CATEGORY_TOAST_LABELS[activeCategory] || "Tez orada");
  }, [activeCategory]);

  useEffect(() => {
    document.body.classList.toggle(
      "has-overlay",
      profileModalOpen || Boolean(modalItem) || adOverlayOpen,
    );
  }, [profileModalOpen, modalItem, adOverlayOpen]);

  useEffect(() => {
    const handleClick = (event) => {
      if (!event.target.closest?.(".telegram-bar__theme")) {
        setThemePanelOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!topToastMessage) return undefined;
    if (topToastTimerRef.current) {
      window.clearTimeout(topToastTimerRef.current);
    }
    topToastTimerRef.current = window.setTimeout(() => {
      setTopToastMessage("");
      topToastTimerRef.current = null;
    }, 1200);
    return () => {
      if (topToastTimerRef.current) {
        window.clearTimeout(topToastTimerRef.current);
        topToastTimerRef.current = null;
      }
    };
  }, [topToastMessage]);

  useEffect(() => {
    if (!soonBadgeVisible) return undefined;
    if (soonBadgeTimerRef.current) {
      window.clearTimeout(soonBadgeTimerRef.current);
    }
    soonBadgeTimerRef.current = window.setTimeout(() => {
      setSoonBadgeVisible(false);
      soonBadgeTimerRef.current = null;
    }, 1200);
    return () => {
      if (soonBadgeTimerRef.current) {
        window.clearTimeout(soonBadgeTimerRef.current);
        soonBadgeTimerRef.current = null;
      }
    };
  }, [soonBadgeVisible]);

  useEffect(() => {
    if (!liveBadgeVisible) return undefined;
    const timerId = window.setTimeout(() => {
      setLiveBadgeVisible(false);
    }, 1200);
    return () => window.clearTimeout(timerId);
  }, [liveBadgeVisible]);

  useEffect(() => {
    if (!profileModalOpen) return;
    profileInputRef.current?.focus();
  }, [profileModalOpen]);

  useEffect(() => {
    if (activeCategory === "EMPTY") {
      holoInputRef.current?.focus();
    }
  }, [activeCategory]);

  useEffect(() => {
    if (activeCategory !== "LIVE") return;
    const container = liveMessageThreadRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [activeCategory, liveMessageItems]);

  useEffect(() => {
    if (!liveEmbedUrl || !liveIsPlaying) return undefined;

    const syncLiveFrameAudio = () => {
      const shouldMute = document.hidden || !document.hasFocus();
      sendLiveFrameCommand(shouldMute ? "mute" : "unMute");
    };

    const handleFrameLoad = () => {
      window.setTimeout(syncLiveFrameAudio, 250);
    };

    const frame = liveFrameRef.current;
    frame?.addEventListener("load", handleFrameLoad);
    window.addEventListener("focus", syncLiveFrameAudio);
    window.addEventListener("blur", syncLiveFrameAudio);
    document.addEventListener("visibilitychange", syncLiveFrameAudio);
    syncLiveFrameAudio();

    return () => {
      frame?.removeEventListener("load", handleFrameLoad);
      window.removeEventListener("focus", syncLiveFrameAudio);
      window.removeEventListener("blur", syncLiveFrameAudio);
      document.removeEventListener("visibilitychange", syncLiveFrameAudio);
    };
  }, [liveEmbedUrl, liveIsPlaying]);

  useEffect(() => {
    if (activeCategory !== "MESSAGE") return;
    const container = messageThreadRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [activeCategory, messageItems]);

  useEffect(() => {
    async function loadCatalog() {
      const items = await loadCatalogItems();
      setCatalogItems(items);
    }

    loadCatalog();
  }, []);

  useEffect(() => {
    async function loadSaved() {
      if (!activeOwnerId) {
        setSavedItems([]);
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/saved-videos?owner_id=${encodeURIComponent(activeOwnerId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("saved videos topilmadi");
        const payload = await response.json();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setSavedItems(items.map(normalizeVideoItem));
      } catch {
        setSavedItems([]);
      }
    }

    loadSaved();
  }, [activeOwnerId]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileData() {
      const avatarUserId = Number(selectedTargetUserIdRef.current || getTelegramUserId() || 0);
      if (!avatarUserId) {
        if (!cancelled) {
          setTelegramProfilePhotoUrl("");
          setRemoteProfileName("");
        }
        return;
      }

      const requestKey = String(avatarUserId);
      const isStaleRequest = () =>
        cancelled || String(selectedTargetUserIdRef.current || getTelegramUserId() || "") !== requestKey;
      try {
        const profileResponse = await fetch(
          `${API_BASE_URL}/api/user-profile?user_id=${encodeURIComponent(avatarUserId)}`,
          { cache: "no-store" },
        );
        const profilePayload = await profileResponse.json().catch(() => ({}));
        if (isStaleRequest()) return;
        if (profileResponse.ok && profilePayload?.ok) {
          setRemoteProfileName(String(profilePayload.display_name || "").trim());
          setTelegramProfilePhotoUrl(String(profilePayload.photo_url || "").trim());
        } else {
          setRemoteProfileName("");
          setTelegramProfilePhotoUrl("");
        }
      } catch (error) {
        console.error("Telegram profil ma'lumoti yuklanmadi:", error);
        if (!cancelled) {
          setTelegramProfilePhotoUrl("");
          setRemoteProfileName("");
        }
      }
    }

    async function loadSharedUsers() {
      const lookupUserId = Number(selectedTargetUserIdRef.current || getTelegramUserId() || 0);
      if (!lookupUserId) {
        if (!cancelled) {
          setSharedProfileUsers([]);
        }
        return;
      }
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/shared-users?user_id=${encodeURIComponent(lookupUserId)}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && payload?.ok && Array.isArray(payload.items)) {
          setSharedProfileUsers(payload.items);
        } else {
          setSharedProfileUsers([]);
        }
      } catch (error) {
        console.error("Shared users yuklanmadi:", error);
        if (!cancelled) {
          setSharedProfileUsers([]);
        }
      }
    }

    const refreshProfilePanel = () => {
      loadProfileData();
      loadSharedUsers();
    };

    refreshProfilePanel();
    const intervalId = window.setInterval(refreshProfilePanel, 5000);
    const onFocus = () => refreshProfilePanel();
    const onVisibility = () => {
      if (!document.hidden) {
        refreshProfilePanel();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedTargetUserId, telegramUserId]);

  useEffect(() => {
    async function refreshCatalogView() {
      if (catalogRefreshInFlightRef.current) return;
      catalogRefreshInFlightRef.current = true;
      try {
        const items = await loadCatalogItems();
        setCatalogItems(items);
      } finally {
        catalogRefreshInFlightRef.current = false;
      }
    }

    refreshIntervalRef.current = window.setInterval(refreshCatalogView, 20000);
    const onFocus = () => {
      refreshCatalogView();
    };
    const onVisibility = () => {
      if (!document.hidden) {
        refreshCatalogView();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (refreshIntervalRef.current) {
        window.clearInterval(refreshIntervalRef.current);
      }
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAdConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/ad-config`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && payload?.ok) {
          const nextItems = normalizeAdItems(payload);
          setAdItems(nextItems);
          setAdIndex((current) => (nextItems.length ? current % nextItems.length : 0));
          return;
        }
        setAdItems([]);
        setAdIndex(0);
      } catch {
        if (!cancelled) {
          setAdItems([]);
          setAdIndex(0);
        }
      }
    }

    loadAdConfig();
    const intervalId = window.setInterval(loadAdConfig, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  async function fetchAdConfigNow() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ad-config`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.ok) {
        const nextItems = normalizeAdItems(payload);
        setAdItems(nextItems);
        setAdIndex((current) => (nextItems.length ? current % nextItems.length : 0));
        return nextItems[0] || null;
      }
      setAdItems([]);
      setAdIndex(0);
      return null;
    } catch {
      setAdItems([]);
      setAdIndex(0);
      return null;
    }
  }

  useEffect(() => {
    if (adItems.length <= 1) {
      setAdIndex(0);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setAdIndex((current) => (current + 1) % adItems.length);
    }, AD_ROTATE_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [adItems]);

  useEffect(() => {
    if (!adOverlayOpen) {
      setAdCloseReady(false);
      setAdCloseCountdown(Math.ceil(adCloseDelayMs / 1000));
      setAdOverlayIndex(0);
      if (adTimerRef.current) {
        window.clearTimeout(adTimerRef.current);
        adTimerRef.current = null;
      }
      if (adCountdownIntervalRef.current) {
        window.clearInterval(adCountdownIntervalRef.current);
        adCountdownIntervalRef.current = null;
      }
      return;
    }

    setAdCloseCountdown(Math.ceil(adCloseDelayMs / 1000));
    adCountdownIntervalRef.current = window.setInterval(() => {
      setAdCloseCountdown((current) => {
        if (current <= 1) {
          if (adCountdownIntervalRef.current) {
            window.clearInterval(adCountdownIntervalRef.current);
            adCountdownIntervalRef.current = null;
          }
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    adTimerRef.current = window.setTimeout(() => {
      setAdCloseReady(true);
      setAdCloseCountdown(0);
      adTimerRef.current = null;
    }, adCloseDelayMs);

    return () => {
      if (adTimerRef.current) {
        window.clearTimeout(adTimerRef.current);
        adTimerRef.current = null;
      }
      if (adCountdownIntervalRef.current) {
        window.clearInterval(adCountdownIntervalRef.current);
        adCountdownIntervalRef.current = null;
      }
    };
  }, [adOverlayOpen, adOverlayIndex, adCloseDelayMs]);

  useEffect(() => {
    if (!hasActiveAd && adOverlayOpen) {
      setAdOverlayOpen(false);
    }
  }, [hasActiveAd, adOverlayOpen]);

  useEffect(() => {
    if (!hasActiveAd) {
      setAdPreviewVisible(false);
      return undefined;
    }

    setAdPreviewVisible(false);
    const timerId = window.setTimeout(() => {
      setAdPreviewVisible(true);
    }, AD_PREVIEW_REVEAL_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, [hasActiveAd, currentAd?.videoUrl]);

  useEffect(() => {
    if (!modalItem) return undefined;

    let cancelled = false;

    async function loadModalState() {
      const reactionParams = new URLSearchParams({ video_id: String(modalItem.id) });
      if (selectedTargetUserIdRef.current) {
        reactionParams.set("user_id", selectedTargetUserIdRef.current);
      }

      try {
        const reactionResponse = await fetch(
          `${API_BASE_URL}/api/video-reactions?${reactionParams.toString()}`,
          { cache: "no-store" },
        );
        const reactionPayload = await reactionResponse.json().catch(() => ({}));
        if (!cancelled && reactionPayload?.ok) {
          setModalReactionState({
            likes: Number(reactionPayload.likes || 0),
            dislikes: Number(reactionPayload.dislikes || 0),
            user_reaction: reactionPayload.user_reaction || null,
          });
        }
      } catch {
        if (!cancelled) {
          setModalReactionState({ likes: 0, dislikes: 0, user_reaction: null });
        }
      }

      if (cancelled) return;
      setModalVideoReady(false);
      setModalVideoMessage("Treyler tayyorlanmoqda...");

      const streamState = await fetchVideoStatus(modalItem, { force: true });
      if (cancelled) return;

      if (streamState?.playable && streamState?.stream_url) {
        setModalVideoUrl(streamState.stream_url);
        setModalVideoReady(true);
        setModalVideoMessage("");
        return;
      }

      const fallbackUrl = getTrailerUrl(modalItem) || normalizeApiUrl(buildVideoFileUrl(modalItem.id));
      if (fallbackUrl) {
        setModalVideoUrl(fallbackUrl);
        setModalVideoReady(true);
        setModalVideoMessage(streamState?.message || "");
        return;
      }

      setModalVideoUrl("");
      setModalVideoReady(false);
      setModalVideoMessage(streamState?.message || "Treyler topilmadi.");
    }

    loadModalState();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeVideoModal();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [modalItem]);

  useEffect(() => {
    const video = modalVideoRef.current;
    if (!video || !modalVideoUrl || !modalVideoReady) return;
    video.muted = false;
    video.volume = 1;
    video.load();
    video
      .play()
      .catch((error) => {
        console.error("Modal video autoplay failed:", error);
      });
  }, [modalVideoReady, modalVideoUrl]);

  function showAppAlert(message) {
    const text = String(message || "").trim() || "Xatolik yuz berdi.";
    if (tg?.showAlert) {
      tg.showAlert(text);
      return;
    }
    window.alert(text);
  }

  function showTopToast(message) {
    const normalized = String(message || "").trim();
    if (!normalized) return;

    const lower = normalized.toLowerCase();
    let text = normalized;
    if (lower.includes("saqlandi")) {
      text = "saqlandi✅";
    } else if (lower.includes("yuborildi")) {
      text = "📤 Yuborildi.";
    } else if (lower.includes("yoqtirildi")) {
      text = "👍 Yoqtirildi.";
    } else if (lower.includes("tez orada")) {
      text = "Tez orada";
    } else if (
      lower.includes("o'chirildi") ||
      lower.includes("ombordan olib tashlandi") ||
      lower.includes("pleylistdan olib tashlandi")
    ) {
      text = "🗑️ O'chirildi.";
    }
    setTopToastMessage(text);
  }

  async function fetchVideoStatus(item, { force = false } = {}) {
    if (!item?.id) {
      return { playable: false, reason: "not_found", message: "Video topilmadi.", stream_url: "" };
    }

    if (String(item?.title || "").toLowerCase().includes("merlin")) {
      const result = {
        playable: true,
        reason: "",
        message: "",
        stream_url: DEFAULT_TRAILER_URL,
      };
      videoStatusCacheRef.current.set(item.id, result);
      return result;
    }

    if (item.trailer_url) {
      const result = {
        playable: true,
        reason: "",
        message: "",
        stream_url: normalizeApiUrl(item.trailer_url),
      };
      videoStatusCacheRef.current.set(item.id, result);
      return result;
    }

    if (item.web_streamable === false) {
      return {
        playable: false,
        reason: item.web_stream_error || "file_too_big",
        message: item.web_stream_message || "Bu video webda ochilmaydi. Uni botga yuboring.",
        stream_url: "",
      };
    }

    if (!force && videoStatusCacheRef.current.has(item.id)) {
      return videoStatusCacheRef.current.get(item.id);
    }

    const fallbackUrl = normalizeApiUrl(
      item.trailer_url || item.trailer_proxy_url || item.stream_url || item.preview_url || buildVideoFileUrl(item.id),
    );
    if (item.web_stream_source === "external" && fallbackUrl) {
      const result = { playable: true, reason: "", message: "", stream_url: fallbackUrl };
      videoStatusCacheRef.current.set(item.id, result);
      return result;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/video/${encodeURIComponent(item.id)}/status`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      const result = {
        playable: payload?.playable !== false,
        reason: payload?.reason || "",
        message: payload?.message || "",
        stream_url: normalizeApiUrl(payload?.stream_url || fallbackUrl),
      };
      if (!response.ok) {
        result.playable = false;
      }
      if (result.reason === "temporary_error" && !result.playable) {
        videoStatusCacheRef.current.delete(item.id);
      } else {
        videoStatusCacheRef.current.set(item.id, result);
      }
      return result;
    } catch {
      return { playable: true, reason: "", message: "", stream_url: fallbackUrl };
    }
  }

  function openProfileModal() {
    if (tg) return;
    if (isAutoDetectedUserId) return;
    setProfileInputValue(selectedTargetUserId);
    setProfileModalOpen(true);
  }

  function closeProfileModal() {
    setProfileModalOpen(false);
  }

  async function submitProfileId() {
    if (isAutoDetectedUserId) {
      closeProfileModal();
      return;
    }

    if (selectedTargetUserId) {
      const wasInPlaylist = activeCategory === "Pleylist";
      setSelectedTargetUserId("");
      setProfileInputValue("");
      setTelegramProfilePhotoUrl("");
      setSharedProfileUsers([]);
      window.localStorage.removeItem(TARGET_USER_STORAGE_KEY);
      window.localStorage.removeItem(targetUserStorageKey);
      setSavedItems([]);
      if (wasInPlaylist) {
        setActiveCategory("LANDING");
      }
      showTopToast("o'chirildi ✅");
      return;
    }

    const rawValue = String(profileInputValue || "").trim();
    if (!/^\d+$/.test(rawValue)) {
      showAppAlert("ID raqam bo'lishi kerak.");
      return;
    }

    setSelectedTargetUserId(rawValue);
    setIsAutoDetectedUserId(false);
    window.localStorage.setItem(targetUserStorageKey, rawValue);
    fetch(`${API_BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: rawValue }),
    }).catch(() => {});
    setProfileModalOpen(false);
    setActiveCategory("Pleylist");
    showTopToast("saqlandi ✅");
  }

  async function performSendVideo(item) {
    if (!item) return false;
    const targetUserId = selectedTargetUserId || getTelegramUserId();
    if (!targetUserId) {
      openProfileModal();
      return false;
    }
    if (pendingSendVideoIdsRef.current.has(item.id)) {
      showTopToast("yuborilmoqda...");
      return false;
    }

    pendingSendVideoIdsRef.current.add(item.id);
    showTopToast("yuborilmoqda...");
    try {
      const response = await fetch(`${API_BASE_URL}/api/send-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "send_video",
          video_id: item.id,
          title: item.saved_name || item.title || "",
          source: activeCategory,
          target_user_id: targetUserId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result?.ok) {
        tg?.HapticFeedback?.notificationOccurred?.("success");
        showTopToast("yuborildi ✅");
        return true;
      }
      tg?.HapticFeedback?.notificationOccurred?.("error");
      showAppAlert(result?.message || result?.error || "Video yuborilmadi.");
      return false;
    } catch (error) {
      console.error("Video yuborishda xatolik:", error);
      tg?.HapticFeedback?.notificationOccurred?.("error");
      showAppAlert("Video yuborishda xatolik bo'ldi.");
      return false;
    } finally {
      pendingSendVideoIdsRef.current.delete(item.id);
    }
  }

  function closeAdOverlay() {
    setAdOverlayOpen(false);
    setAdOverlayIndex(0);
    setAdCloseReady(false);
  }

  async function handleAdOverlayClose() {
    if (!adCloseReady || !pendingAdSendItem) return;
    if (isOverlayMultiAd && !isOverlayLastAd) {
      setAdOverlayIndex((current) => current + 1);
      setAdCloseReady(false);
      return;
    }
    const nextItem = pendingAdSendItem;
    closeAdOverlay();
    setPendingAdSendItem(null);
    await performSendVideo(nextItem);
  }

  async function sendVideoToBot(item) {
    if (!item) return;
    const nextAd = currentAd?.videoUrl ? currentAd : await fetchAdConfigNow();
    if (nextAd?.videoUrl) {
      setPendingAdSendItem(item);
      setAdOverlayStartIndex(adItems.length ? adIndex % adItems.length : 0);
      setAdOverlayIndex(0);
      setAdCloseReady(false);
      setAdOverlayOpen(true);
      return;
    }
    await performSendVideo(item);
  }

  async function saveVideoToProfile(item) {
    const ownerId = selectedTargetUserId || getTelegramUserId();
    if (!ownerId || !item?.id) {
      openProfileModal();
      return false;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/save-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: ownerId, video_id: item.id }),
      });
      const result = await response.json();
      if (!result?.ok) {
        showAppAlert(result?.message || result?.error || "Video saqlanmadi.");
        return false;
      }

      const savedResponse = await fetch(
        `${API_BASE_URL}/api/saved-videos?owner_id=${encodeURIComponent(ownerId)}`,
        { cache: "no-store" },
      );
      const savedPayload = await savedResponse.json().catch(() => ({}));
      const items = Array.isArray(savedPayload?.items) ? savedPayload.items : [];
      setSavedItems(items.map(normalizeVideoItem));
      showTopToast(
        result?.already_saved
          ? "Allaqachon saqlangan. Playlistingizni /playlist orqali ko'ring."
          : "Saqlandi. Playlistingizni /playlist orqali ko'ring.",
      );
      return true;
    } catch {
      showAppAlert("Video saqlashda xatolik bo'ldi.");
      return false;
    }
  }

  async function deleteSavedVideo(item) {
    if (!item?.id || !activeOwnerId) {
      openProfileModal();
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/delete-saved-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: activeOwnerId, video_id: item.id }),
      });
      const result = await response.json();
      if (!result?.ok) {
        showAppAlert(result?.message || result?.error || "Video o'chirilmadi.");
        return;
      }
      setSavedItems((current) =>
        current.filter((savedItem) => Number(savedItem.id) !== Number(item.id)),
      );
      showTopToast("pleylistdan olib tashlandi ✅");
    } catch {
      showAppAlert("Video o'chirishda xatolik bo'ldi.");
    }
  }

  async function reactToVideo(item) {
    const ownerId = selectedTargetUserId || getTelegramUserId();
    if (!ownerId || !item?.id) {
      openProfileModal();
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/react-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: ownerId,
          video_id: item.id,
          reaction: "likes",
        }),
      });
      const result = await response.json();
      if (!result?.ok) {
        showAppAlert(result?.message || result?.error || "Like qo'yilmadi.");
        return;
      }
      setModalReactionState(result);
      showTopToast("yoqtirildi 👍");
    } catch {
      showAppAlert("Like qo'yishda xatolik bo'ldi.");
    }
  }

  function closeVideoModal() {
    if (modalVideoRef.current) {
      modalVideoRef.current.pause();
      modalVideoRef.current.removeAttribute("src");
      modalVideoRef.current.load();
    }
    setModalItem(null);
    setModalVideoUrl("");
    setModalVideoReady(false);
    setModalVideoMessage("Video tayyorlanmoqda...");
    setModalReactionState({ likes: 0, dislikes: 0, user_reaction: null });
  }

  function handleBottomDock(category) {
    if (category === "Pleylist" && !activeOwnerId) {
      openProfileModal();
      return;
    }
    startTransition(() => {
      setTopToastMessage("");
      setSoonBadgeVisible(false);
      setLiveBadgeVisible(category === "LIVE");
      if (category !== "EMPTY") {
        setActiveQuery("");
      }
      setActiveCategory(category);
    });
  }

  function openLandingLink() {
    window.location.href = "https://esp-esp-esp.onrender.com";
  }

  function openAdLink() {
    const activeAdLink = adOverlayOpen ? currentOverlayAd?.linkUrl : currentAd?.linkUrl;
    const targetUrl = String(activeAdLink || "").trim();
    if (!targetUrl) return;
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }

  function openMessageUserPreview(item) {
    const nextUserId = String(item?.user_id || "").trim();
    if (!nextUserId) return;
    setMessagePreviewUser({
      userId: nextUserId,
      userName: String(item?.user_name || "").trim() || `ID ${nextUserId}`,
      photoUrl:
        String(item?.photo_url || "").trim() ||
        (String(nextUserId) === String(telegramUserId || "") ? photoUrl : ""),
    });
  }

  function closeMessageUserPreview() {
    setMessagePreviewUser(null);
  }

  function submitLiveMessageDraft() {
    const nextText = String(liveMessageDraft || "").trim();
    if (!nextText) return;
    const messageUserId = selectedTargetUserId || telegramUserId || "";
    const messageUserName = profileDisplayName || (messageUserId ? `ID ${messageUserId}` : "Guest");

    fetch(`${API_BASE_URL}/api/live-messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: nextText,
        user_id: messageUserId,
        user_name: messageUserName,
        photo_url: photoUrl,
      }),
    })
      .then((response) => response.json().catch(() => ({})).then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload?.ok || !payload?.item) return;
        setLiveMessageItems((current) => [...current, payload.item].slice(-45));
        setLiveMessageDraft("");
      })
      .catch(() => {});
  }

  function submitMessageDraft() {
    const nextText = String(messageDraft || "").trim();
    if (!nextText) return;
    const messageUserId = selectedTargetUserId || telegramUserId || "";
    const messageUserName = profileDisplayName || (messageUserId ? `ID ${messageUserId}` : "Guest");

    fetch(`${API_BASE_URL}/api/chat-messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: nextText,
        user_id: messageUserId,
        user_name: messageUserName,
        photo_url: photoUrl,
      }),
    })
      .then((response) => response.json().catch(() => ({})).then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload?.ok || !payload?.item) return;
        setMessageItems((current) => [...current, payload.item].slice(-45));
        setMessageDraft("");
      })
      .catch(() => {});
  }

  const sectionTitle = activeQuery
    ? "Qidiruv natijalari"
    : activeCategory === "LANDING"
      ? "Bosh sahifa"
      : activeCategory === "LIVE"
        ? "Live"
      : activeCategory === "PROFILE"
        ? "Profil"
        : activeCategory === "EMPTY"
          ? "Maxsus panel"
          : activeCategory === "Pleylist"
            ? "Saqlangan videolar"
            : "So'nggi videolar";
  const sectionMeta = activeQuery
    ? `${filteredItems.length} ta natija`
    : activeCategory === "LANDING"
      ? "Bo'lim tanlang"
      : activeCategory === "LIVE"
        ? "Jonli bo'lim"
      : activeCategory === "PROFILE"
        ? "Foydalanuvchi oynasi"
        : activeCategory === "EMPTY"
          ? "Interfeys tayyor"
          : `${filteredItems.length} ta video`;
  const emptyText = activeQuery
    ? "Qidiruv bo'yicha hech narsa topilmadi."
    : activeCategory === "Pleylist"
      ? "Pleylistda hali video yo'q."
      : "Katalogda hozircha video topilmadi.";

  const activeDock = profileModalOpen
    ? "profile"
    : activeCategory === "PROFILE"
      ? "profile"
      : activeCategory === "LIVE"
        ? "live"
      : activeCategory === "EMPTY"
        ? "empty"
        : activeCategory === "Pleylist"
          ? "saved"
          : activeCategory === "HOME"
            ? "playlist"
            : "home";
  const showTopBar =
    activeCategory === "LANDING" || activeCategory === "HOME" || activeCategory === "Pleylist";
  const topBarTitle =
    activeCategory === "HOME"
      ? "Barcha kinolar"
      : activeCategory === "Pleylist"
        ? "Siz saqlagan videolar"
        : "Hidop_bot";
  const showCompactTopBar = activeCategory === "HOME" || activeCategory === "Pleylist";
  const topBarCount = activeCategory === "HOME" ? catalogItems.length : savedItems.length;

  return (
    <div className="app-shell">
      <header className="telegram-bar" style={{ display: showTopBar ? "" : "none" }}>
        <div className={`telegram-bar__brand ${playIntroAnimations ? "is-intro" : ""}`}>
          {showCompactTopBar ? null : (
            <div className="telegram-bar__theme">
              <button
                className="telegram-bar__logo"
                type="button"
                aria-label="Rang tanlash"
                aria-expanded={themePanelOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setThemePanelOpen((current) => !current);
                }}
              >
                H
              </button>
              <div className={`theme-panel ${themePanelOpen ? "" : "is-hidden"}`} aria-label="Rang variantlari">
                {THEME_OPTIONS.map(({ id, label }) => (
                  <button
                    key={id}
                    className={`theme-panel__option ${theme === id ? "is-active" : ""}`}
                    type="button"
                    data-theme={id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setTheme(id);
                      setThemePanelOpen(false);
                    }}
                  >
                    <span className={`theme-panel__swatch theme-panel__swatch--${id}`}></span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="telegram-bar__content">
            <strong>{topBarTitle}</strong>
          </div>
          {showCompactTopBar ? (
            <div className="telegram-bar__count" aria-label={`Jami ${topBarCount} ta`}>
              {topBarCount} ta
            </div>
          ) : (
            <div className="telegram-bar__actions">
              <button
                className={`telegram-bar__icon telegram-bar__profile ${photoUrl ? "has-photo-avatar" : ""}`}
                type="button"
                aria-label={selectedTargetUserId ? `Profil ${selectedTargetUserId}` : "Profil"}
                onClick={openProfileModal}
              >
                <Avatar className="profile-badge" photoUrl={photoUrl} fallbackText={profileBadgeText} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className={`profile-modal ${profileModalOpen ? "" : "is-hidden"}`} aria-hidden={!profileModalOpen}>
        <div className="profile-modal__backdrop" onClick={closeProfileModal}></div>
        <div className="profile-card" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle">
          <button className="profile-card__close" type="button" aria-label="Yopish" onClick={closeProfileModal}>
            ×
          </button>
          <Avatar className="profile-card__badge" photoUrl={photoUrl} fallbackText={profileBadgeText} />
          <p className="profile-card__eyebrow">Profil</p>
          <h2 id="profileModalTitle">{profileDisplayName}</h2>
          <p className="profile-card__description">
            Pleylist, like va yuborish funksiyalarini profil ID bilan ulang.
          </p>
          <label className="profile-card__field" htmlFor="profileInput">
            <input
              id="profileInput"
              ref={profileInputRef}
              type="text"
              placeholder="ID ingizni kiriting"
              inputMode="numeric"
              value={profileInputValue}
              readOnly={Boolean(selectedTargetUserId) || isAutoDetectedUserId}
              onChange={(event) => setProfileInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitProfileId();
                }
              }}
            />
          </label>
          <button
            className={`profile-card__submit ${selectedTargetUserId && !isAutoDetectedUserId ? "profile-card__submit--danger" : ""}`}
            type="button"
            disabled={isAutoDetectedUserId}
            onClick={submitProfileId}
          >
            {isAutoDetectedUserId
              ? "TELEGRAM ORQALI ULANGAN"
              : selectedTargetUserId
                ? "O'CHIRISH"
                : "KIRISH"}
          </button>
        </div>
      </div>

      <div className="save-success-modal is-hidden" aria-hidden="true">
        <div className="save-success-card" role="dialog" aria-modal="true">
          <h3 className="save-success-card__title">Telegram</h3>
          <p className="save-success-card__status">✅ Saqlandi!</p>
          <p className="save-success-card__description">playlist orqali ko'ring</p>
          <button className="save-success-card__button" type="button">
            OK
          </button>
        </div>
      </div>

      <section className="sheet">
        <main className="content">
          <section className="content-block">
            <div className="section-heading" style={{ display: showCatalogChrome ? "" : "none" }}>
              <div>
                <p className="section-heading__eyebrow">Katalog</p>
                <h2>{sectionTitle}</h2>
              </div>
              <p className="section-heading__meta">{sectionMeta}</p>
            </div>

            <section className={`holo-panel ${activeCategory === "EMPTY" ? "" : "is-hidden"}`} aria-label="Maxsus qidiruv">
              <div className="input-container">
                <div className="input-field-container">
                  <input
                    ref={holoInputRef}
                    type="text"
                    className="holo-input"
                    placeholder="Kino nomi yoki ID"
                    value={activeQuery}
                    onChange={(event) => setActiveQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setActiveQuery("");
                      }
                    }}
                  />
                  <div
                    className={`holo-results-count ${activeCategory === "EMPTY" && activeQuery.trim() ? "" : "is-hidden"}`}
                  >
                    {filteredItems.length} ta natija
                  </div>
                  <div className="input-border"></div>
                  <div className="holo-scan-line"></div>
                  <div className="input-glow"></div>
                  <div className="input-active-indicator"></div>
                  <div className="input-label">Qidiruv paneli</div>
                  <div className="input-data-visualization">
                    {Array.from({ length: 20 }).map((_, index) => (
                      <div key={index} className="data-segment" style={{ "--index": index + 1 }}></div>
                    ))}
                  </div>
                  <div className="input-particles">
                    {[
                      { top: "20%", left: "10%" },
                      { top: "65%", left: "25%" },
                      { top: "40%", left: "40%" },
                      { top: "75%", left: "60%" },
                      { top: "30%", left: "75%" },
                      { top: "60%", left: "90%" },
                    ].map((position, index) => (
                      <div
                        key={index}
                        className="input-particle"
                        style={{ "--index": index + 1, top: position.top, left: position.left }}
                      ></div>
                    ))}
                  </div>
                  <div className="input-holo-overlay"></div>
                  <div className="interface-lines">
                    <div className="interface-line"></div>
                    <div className="interface-line"></div>
                    <div className="interface-line"></div>
                    <div className="interface-line"></div>
                  </div>
                  <div className="hex-decoration"></div>
                  <div className="input-status">Ready for input</div>
                  <div className="power-indicator"></div>
                  <div className="input-decoration">
                    <div className="decoration-dot"></div>
                    <div className="decoration-line"></div>
                    <div className="decoration-dot"></div>
                    <div className="decoration-line"></div>
                    <div className="decoration-dot"></div>
                    <div className="decoration-line"></div>
                    <div className="decoration-dot"></div>
                  </div>
                </div>
              </div>
            </section>

            <section className={`landing-panel ${activeCategory === "LANDING" ? "" : "is-hidden"}`} aria-label="Bot haqida">
              <div className="landing-panel__hero">
                <img className={`landing-panel__brand-image ${playIntroAnimations ? "is-intro" : ""}`} src={hidopImage} alt="Hidop_bot" />
                {hasActiveAd ? (
                  <div
                    className={`landing-panel__ad ${adPreviewVisible ? "is-visible" : "is-hidden"}`}
                    aria-label="Reklama preview"
                  >
                    <video
                      className="landing-panel__ad-video"
                      src={currentAd.videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                    ></video>
                    <button className="landing-panel__ad-open" type="button" onClick={openAdLink}>
                      Open
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
            <section className={`live-panel ${activeCategory === "LIVE" ? "" : "is-hidden"}`} aria-label="Live bo'limi">
              <div className="live-panel__hero">
                <iframe
                  ref={liveFrameRef}
                  className={`live-panel__frame ${liveIsPlaying ? "" : "is-hidden"}`}
                  src={liveIsPlaying ? liveEmbedUrl : "about:blank"}
                  title={liveCurrentItem?.title || "YouTube live"}
                  allow="autoplay; fullscreen"
                />
                <div className={`live-panel__video-placeholder ${liveIsPlaying ? "is-hidden" : ""}`}>
                  <div className="live-panel__placeholder-copy">
                    <p className="live-panel__placeholder-title">
                      {liveIsReady ? liveCurrentItem?.title || "Jonli efir tayyor" : "Hozirda live mavjud emas"}
                    </p>
                    <p className={`live-panel__placeholder-status ${liveIsReady ? "" : "is-hidden"}`}>
                      Live tayyor. Kirish uchun boshlash tugmasini bosing.
                    </p>
                    <button
                      className={`live-panel__start ${liveIsReady ? "" : "is-hidden"}`}
                      type="button"
                      onClick={() => setLiveEntryRequested(true)}
                    >
                      Boshlash
                    </button>
                  </div>
                </div>
                <div className={`live-panel__overlay-stack ${liveIsPlaying ? "" : "is-hidden"}`}>
                  <div className={`live-panel__chat-feed ${liveMessageItems.length ? "" : "is-hidden"}`} ref={liveMessageThreadRef}>
                    {liveMessageItems.slice(-3).map((item) => (
                      <div key={item.id} className="live-panel__chat-item">
                        <Avatar
                          className="live-panel__chat-avatar"
                          photoUrl={item.photo_url}
                          fallbackText={getInitials(item.user_name || item.user_id || "U")}
                          alt={item.user_name || "User"}
                        />
                        <div className="live-panel__chat-copy">
                          <span className="live-panel__chat-author">
                            {item.user_name || (item.user_id ? `ID ${item.user_id}` : "User")}
                          </span>
                          <span className="live-panel__chat-message">{item.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="live-panel__overlay is-current">
                    <span className="live-panel__overlay-text">
                      {liveCurrentItem?.title || "YouTube Live"}
                    </span>
                  </div>
                </div>
              </div>
              <div className={`live-panel__floating-composer ${liveIsReady ? "" : "is-hidden"}`}>
                <input
                  className="message-panel__input"
                  type="text"
                  placeholder="Live chatga yozing..."
                  value={liveMessageDraft}
                  onChange={(event) => setLiveMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitLiveMessageDraft();
                    }
                  }}
                />
                <button
                  className="message-panel__send"
                  type="button"
                  onClick={submitLiveMessageDraft}
                  disabled={!liveMessageDraft.trim()}
                >
                  Yuborish
                </button>
              </div>
            </section>
            <section
              className={`profile-showcase ${activeCategory === "PROFILE" ? "" : "is-hidden"}`}
              aria-label="Profil oynasi"
            >
              <div className="profile-showcase__card">
                <Avatar
                  className="profile-showcase__avatar"
                  photoUrl={photoUrl}
                  fallbackText={profileBadgeText}
                />
                <p className="profile-showcase__eyebrow">Profil</p>
                <h3 className="profile-showcase__title">
                  {profileDisplayName}
                </h3>
                <p className="profile-showcase__meta">
                  {selectedTargetUserId
                    ? "Telegram profilingiz shu bo'limda ko'rinadi."
                    : "Profil rasmini ko'rish uchun Telegram profilingizdan foydalaniladi."}
                </p>
                <div className={`profile-showcase__shared ${sharedProfileUsers.length ? "" : "is-hidden"}`}>
                  <p className="profile-showcase__shared-label">
                    {sharedProfileUsers.length} ta odamga ulashilgan
                  </p>
                  <div className="profile-showcase__shared-list">
                    {sharedProfileUsers.map((item, index) =>
                      item?.photo_url ? (
                        <span
                          key={`${item.user_id || index}`}
                          className="profile-showcase__shared-avatar has-photo"
                          title={item?.title || `ID ${item?.user_id || ""}`}
                        >
                          <img src={item.photo_url} alt={item?.title || `ID ${item?.user_id || ""}`} />
                        </span>
                      ) : (
                        <span
                          key={`${item.user_id || index}`}
                          className="profile-showcase__shared-avatar"
                          title={item?.title || `ID ${item?.user_id || ""}`}
                        >
                          {getInitials(item?.title || item?.user_id)}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="playlist">
              {filteredItems.map((item) => {
                const posterUrl = item.poster_url || DEFAULT_POSTER_URL;
                const palette = ["night", "instagram", "youtube"].includes(item.palette)
                  ? item.palette
                  : "night";
                return (
                  <article
                    key={item.id}
                    className="card"
                    style={{ "--card-edge": item.palette === "instagram"
                      ? "linear-gradient(135deg, #ffbb6f 0%, #ff6c87 45%, #885cff 100%)"
                      : item.palette === "youtube"
                        ? "linear-gradient(135deg, #ff8b6d 0%, #ff5573 44%, #ffc35b 100%)"
                        : "linear-gradient(135deg, #77f1cf 0%, #6f9bff 52%, #a7c6ff 100%)" }}
                    onClick={() => setModalItem(item)}
                  >
                    <div className="card__frame">
                      <div className={`thumb thumb--${palette}`} data-video-id={item.id}>
                        {posterUrl ? (
                          <div className="thumb__poster" style={{ backgroundImage: `url('${posterUrl}')` }}></div>
                        ) : null}
                        <div
                          className="thumb__video-overlay"
                          style={{ backgroundImage: `url('${videoOverlayImage}')` }}
                        ></div>
                        <div className="thumb__overlay">
                          <div className="thumb__head">
                            <div className="thumb__badge thumb__badge--title">
                              <ScrollingText text={getDisplayTitle(item)} className="thumb__marquee" />
                            </div>
                            <div className="thumb__badge thumb__badge--time">
                              {formatDuration(item.duration || 0)}
                            </div>
                          </div>
                          <div className="thumb__content">
                            <div className="meta__buttons thumb__buttons">
                              {activeCategory !== "Pleylist" ? (
                                <button
                                  className="save-button"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    saveVideoToProfile(item);
                                  }}
                                >
                                  Saqlash
                                </button>
                              ) : null}
                              <button
                                className="send-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  sendVideoToBot(item);
                                }}
                              >
                                Yuborish
                              </button>
                              {activeCategory === "Pleylist" ? (
                                <button
                                  className="delete-button"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteSavedVideo(item);
                                  }}
                                >
                                  O&apos;chirish
                                </button>
                              ) : null}
                            </div>
                            <div className="thumb__label-wrap">
                              <div className="thumb__sub">
                                <ScrollingText
                                  text={getDisplayDescription(item)}
                                  className="thumb__sub-marquee"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
            <p className={`empty ${showEmptyState && !filteredItems.length ? "" : "is-hidden"}`}>
              {showEmptyState ? emptyText : "Hech narsa topilmadi."}
            </p>
          </section>
        </main>
      </section>

      <a
        className={`profile-showcase__cta profile-showcase__cta--dock ${activeCategory === "PROFILE" ? "is-active" : ""}`}
        href={PROFILE_CTA_URL}
        target="_blank"
        rel="noreferrer"
        aria-hidden={activeCategory === "PROFILE" ? "false" : "true"}
        tabIndex={activeCategory === "PROFILE" ? 0 : -1}
      >
        <span className="profile-showcase__cta-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <path
              d="M21.4 4.6a2 2 0 0 0-2.08-.34L4.76 10.08a1.75 1.75 0 0 0 .12 3.3l4.7 1.54 1.54 4.7a1.75 1.75 0 0 0 3.3.12l5.82-14.56a2 2 0 0 0-.34-2.08Zm-9.93 10.17-.87 3.02-1.07-3.28 7.97-7.97-6.03 8.23Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="profile-showcase__cta-label">🅼🆄🆁🅾🅹🅰🆃 🆄🅲🅷🆄🅽</span>
      </a>

      <nav className="bottom-dock" aria-label="Pastki navigatsiya">
        <div
          className={`top-toast top-toast--${activeDock} ${topToastMessage ? "is-visible" : "is-hidden"}`}
          role="status"
          aria-live="polite"
        >
          {topToastMessage || "saqlandi ✅"}
        </div>
        <button
          className={`bottom-dock__item ${activeDock === "home" ? "is-active" : ""}`}
          type="button"
          aria-label="Bosh sahifa"
          onClick={() => handleBottomDock("LANDING")}
        >
          <span className="bottom-dock__icon bottom-dock__icon--home"></span>
        </button>
        <button
          className={`bottom-dock__item ${activeDock === "live" ? "is-active" : ""}`}
          type="button"
          aria-label="Videolar tezkor tugmasi"
          onClick={() => handleBottomDock("LIVE")}
        >
          {liveBadgeVisible ? (
            <span className="bottom-dock__soon is-visible">live</span>
          ) : null}
          <span className="bottom-dock__icon bottom-dock__icon--reels-outline"></span>
        </button>
        <button
          className={`bottom-dock__item ${activeDock === "playlist" ? "is-active" : ""}`}
          type="button"
          aria-label="Videolar"
          onClick={() => handleBottomDock("HOME")}
        >
          <span className={`bottom-dock__count ${activeDock === "playlist" ? "" : "is-hidden"}`}>{catalogItems.length}</span>
          <span className="bottom-dock__icon bottom-dock__icon--reels"></span>
        </button>
        <button
          className={`bottom-dock__item ${activeDock === "saved" ? "is-active" : ""}`}
          type="button"
          aria-label="Saqlangan videolar"
          onClick={() => handleBottomDock("Pleylist")}
        >
          <span className={`bottom-dock__count bottom-dock__count--saved ${activeDock === "saved" ? "" : "is-hidden"}`}>
            {savedItems.length}
          </span>
          <span className="bottom-dock__icon bottom-dock__icon--saved"></span>
        </button>
        <button
          className={`bottom-dock__item bottom-dock__item--empty ${activeDock === "empty" ? "is-active" : ""}`}
          type="button"
          aria-label="Qidiruv paneli"
          onClick={() => handleBottomDock("EMPTY")}
        >
          <span
            className={`bottom-dock__count bottom-dock__count--results ${activeDock === "empty" && activeCategory === "EMPTY" && activeQuery.trim() ? "" : "is-hidden"}`}
          >
            {filteredItems.length}
          </span>
          <span className="bottom-dock__icon bottom-dock__icon--search" aria-hidden="true"></span>
        </button>
        <button
          className={`bottom-dock__item bottom-dock__item--profile ${photoUrl ? "has-photo-avatar" : ""} ${activeDock === "profile" ? "is-active" : ""}`}
          type="button"
          aria-label={selectedTargetUserId ? `Profil ${selectedTargetUserId}` : "Profil"}
          onClick={() => handleBottomDock("PROFILE")}
        >
          <Avatar className="bottom-dock__avatar" photoUrl={photoUrl} fallbackText={profileBadgeText} />
        </button>
      </nav>

      {adOverlayOpen && hasActiveAd ? (
        <div className="ad-overlay" role="dialog" aria-modal="true" aria-label="Reklama">
          <div className="ad-overlay__backdrop"></div>
          <div className="ad-overlay__dialog">
            <button
              className={`ad-overlay__close ${adCloseReady ? "is-ready" : "is-counting"}`}
              type="button"
              aria-label="Reklamani yopish"
              onClick={handleAdOverlayClose}
              disabled={!adCloseReady}
            >
              {adCloseReady ? (isOverlayMultiAd && !isOverlayLastAd ? "→" : "×") : adCloseCountdown}
            </button>
            <button className="ad-overlay__media" type="button" onClick={openAdLink}>
              <video
                className="ad-overlay__video"
                src={currentOverlayAd?.videoUrl || currentAd?.videoUrl || ""}
                autoPlay
                defaultMuted={false}
                playsInline
                preload="auto"
              ></video>
            </button>
          </div>
        </div>
      ) : null}

      {modalItem ? (
        <div className="video-modal" data-item-id={modalItem.id} onClick={closeVideoModal}>
          <div className="video-modal__dialog" onClick={(event) => event.stopPropagation()}>
            <div className="video-modal__header">
              <div>
                <p className="video-modal__eyebrow">Preview</p>
                <h3>{getDisplayTitle(modalItem)}</h3>
                <p className="video-modal__meta">
                  {(modalItem.category || detectCategory(modalItem))} • {formatDuration(Number(modalItem.duration || 0))} •{" "}
                  {getDisplayDescription(modalItem)}
                </p>
              </div>
              <button className="video-modal__close" type="button" aria-label="Yopish" onClick={closeVideoModal}>
                ×
              </button>
            </div>
            <div className="video-modal__body">
              <div className={`video-modal__status ${modalVideoReady ? "is-hidden" : ""}`}>{modalVideoMessage}</div>
              <video
                ref={modalVideoRef}
                className="video-modal__video"
                controls
                autoPlay
                defaultMuted={false}
                preload="auto"
                playsInline
                style={{ display: modalVideoReady ? "" : "none" }}
                src={modalVideoUrl}
                poster={modalItem.poster_url || DEFAULT_POSTER_URL}
                onLoadedData={() => {
                  setModalVideoReady(true);
                }}
                onError={() => {
                  setModalVideoReady(false);
                  setModalVideoMessage("Treyler yuklanmadi.");
                }}
              ></video>
            </div>
            <div className="video-modal__actions">
              <button
                className="video-modal__button video-modal__button--ghost"
                type="button"
                onClick={() => saveVideoToProfile(modalItem)}
              >
                Saqlash
              </button>
              <button
                className="video-modal__button video-modal__button--primary"
                type="button"
                onClick={() => sendVideoToBot(modalItem)}
              >
                Yuborish
              </button>
              <button
                className={`video-modal__button video-modal__button--ghost video-modal__button--like ${modalReactionState.user_reaction === "likes" ? "is-active" : ""}`}
                type="button"
                onClick={() => reactToVideo(modalItem)}
              >
                👍 {Number(modalReactionState.likes || 0)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
