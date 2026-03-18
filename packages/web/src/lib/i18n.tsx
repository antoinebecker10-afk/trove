import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type Locale = "en" | "fr";

type TranslationLeaf = string;
type TranslationBranch = { [key: string]: TranslationLeaf | TranslationBranch };
type TranslationTree = { [key: string]: TranslationLeaf | TranslationBranch };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

/* ------------------------------------------------------------------ */
/*  Storage                                                            */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "trove-locale";
const DEFAULT_LOCALE: Locale = "fr";

function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "fr") return stored;
  } catch { /* SSR / blocked storage */ }
  return DEFAULT_LOCALE;
}

function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  Translations                                                       */
/* ------------------------------------------------------------------ */

export const translations: Record<Locale, TranslationTree> = {
  en: {
    /* ---- Header / Nav ---- */
    nav: {
      search: "Search",
      sources: "Sources",
      files: "Files",
      back: "Back to home",
    },

    /* ---- Hero / Landing ---- */
    hero: {
      tagline1: "Everything you've made.",
      tagline2: "One search away.",
      ctrlKHint: "to search from anywhere",
    },

    /* ---- Search ---- */
    search: {
      placeholder: "Search your content...",
      searching: "Searching your content...",
      noResults: "No results",
      connectionFailed: "Connection failed",
      retry: "Retry",
    },

    /* ---- Stats pills ---- */
    stats: {
      repos: "Repos",
      files: "Files",
      docs: "Docs",
      images: "Images",
      videos: "Videos",
    },

    /* ---- Filter bar ---- */
    filter: {
      all: "All",
      results: "results",
      /* Type labels */
      github: "GitHub",
      image: "Image",
      video: "Video",
      file: "File",
      document: "Document",
      bookmark: "Bookmark",
      code: "Code",
      note: "Note",
      message: "Message",
      /* Source labels */
      local: "Local",
      discord: "Discord",
      notion: "Notion",
      obsidian: "Obsidian",
      slack: "Slack",
      figma: "Figma",
      linear: "Linear",
      airtable: "Airtable",
      dropbox: "Dropbox",
      confluence: "Confluence",
      raindrop: "Raindrop",
      googleDrive: "Google Drive",
    },

    /* ---- Content card ---- */
    card: {
      open: "Open",
      preview: "Preview",
      move: "Move",
      copyPath: "Copy path",
      openOnGithub: "Open on GitHub",
      openInDiscord: "Open in Discord",
      stars: "stars",
    },

    /* ---- File Manager ---- */
    fileManager: {
      favorites: "Favorites",
      pastePath: "Paste a path to navigate...",
      movedFiles: "Moved {count} file(s)",
      undo: "Undo",
      undoComplete: "Undo complete",
      undoFailed: "Undo failed",
      rightClickToUnpin: "Right-click to unpin",
      unpin: "Unpin",
      showFavorites: "Show favorites",
      collapseSidebar: "Collapse sidebar",
      go: "GO",
      dragHints: "Drag \u00B7 Ctrl+Click \u00B7 Dbl-click \u00B7 Right-click",
      keyHints: "Del \u00B7 F2 \u00B7 Ctrl+C \u00B7 Enter",
    },

    /* ---- File Pane ---- */
    filePane: {
      name: "Name",
      size: "Size",
      modified: "Modified",
      goUp: "Go up",
      newFolder: "New folder",
      folderNamePrompt: "Folder name:",
      filterFiles: "Filter files...",
      emptyFolder: "Empty folder",
      items: "items",
      selected: "selected",
      dropHere: "Drop here",
      listView: "List view",
      gridView: "Grid view",
      delete: "Delete",
      confirmDelete: "Delete {count} item(s)?",
      moving: "Moving {count} file(s)",
    },

    /* ---- File Preview ---- */
    filePreview: {
      preview: "Preview",
      open: "Open",
      move: "Move",
      copyPath: "Copy Path",
      loading: "Loading...",
      noPreview: "No preview",
      openInApp: "Use Open to view in default app",
    },

    /* ---- Move Dialog ---- */
    moveDialog: {
      moveTo: "Move to...",
      moving: "Moving:",
      movingAction: "MOVING...",
      moveHere: "Move Here",
      cancel: "Cancel",
      goUp: "Go up",
      loading: "LOADING...",
      noSubdirectories: "No subdirectories",
    },

    /* ---- Command Palette ---- */
    commandPalette: {
      searchAnything: "Search anything...",
      typeToSearch: "Type to search",
      open: "OPEN",
      path: "PATH",
      noResults: "No results",
      navigate: "navigate",
      openAction: "open",
      close: "close",
    },

    /* ---- Keyboard Help ---- */
    keyboard: {
      title: "Keyboard Shortcuts",
      navigation: "Navigation",
      fileManager: "File Manager",
      search: "Search",
      general: "General",
      /* Navigation shortcuts */
      switchTabs: "Switch view tabs",
      cyclePanels: "Cycle between panels",
      navigateList: "Navigate list items",
      openSelected: "Open selected item",
      /* File Manager shortcuts */
      goParent: "Go to parent directory",
      quickPreview: "Quick preview file",
      newFolder: "New folder",
      rename: "Rename selected",
      deleteSelected: "Delete selected",
      /* Search shortcuts */
      openPalette: "Open command palette",
      focusSearch: "Focus search bar",
      clearSearch: "Clear search / close",
      /* General shortcuts */
      showHelp: "Show this help",
      reindex: "Reindex sources",
      openSettings: "Open settings",
      closeModal: "Close modal / overlay",
    },

    /* ---- Sources View ---- */
    sources: {
      title: "Sources",
      subtitle: "Connect your tools and let Trove index everything in one place.",
      connected: "Connected",
      available: "Available",
      comingSoon: "Coming Soon",
      itemsIndexed: "Items indexed",
      index: "Index",
      indexing: "Indexing...",
      disconnect: "Disconnect",
      connect: "Connect",
      configure: "Configure",
      next: "Next",
      save: "Save",
      back: "Back",
      cancel: "Cancel",
      token: "Token",
      apiKey: "API Key",
      tokenSet: "Token set",
      tokenMissing: "Token missing",
      tokenProvided: "Token provided",
      tokenRequired: "Token is required",
      requiresToken: "Requires token",
      pasteToken: "Paste your token here...",
      getToken: "Get your token",
      noConfigNeeded: "No additional configuration needed. Click Connect to finish.",
      isSet: "is set",
      connecting: "Connecting...",
      connectedMsg: "Connected! Click Index to start indexing.",
      stepOf: "Step {current} of {total}",
      setupFailed: "Setup failed",
      indexedItems: "Indexed {count} items from {source}",
      doneItems: "Done \u2014 {count} items indexed",
      disconnectConfirm: "Disconnect {id}? This removes it from your config.",
      disconnected: "{id} disconnected",
      yes: "Yes",
      no: "No",
    },

    /* ---- Boot Sequence ---- */
    boot: {
      name: "TROVE",
      tagline: "Your content. All of it.",
    },

    /* ---- Status Bar ---- */
    status: {
      connected: "Connected",
      offline: "Offline",
      items: "items",
      justNow: "just now",
      mAgo: "{n}m ago",
      hAgo: "{n}h ago",
      dAgo: "{n}d ago",
    },

    /* ---- AI Answer ---- */
    ai: {
      badge: "AI",
    },

    /* ---- Toast ---- */
    toast: {
      undo: "Undo",
    },

    /* ---- System Info ---- */
    system: {
      ram: "RAM",
      disk: "Disk",
      cpuCores: "CPU cores",
      platform: "Platform",
      node: "Node",
    },

    /* ---- MCP Banner ---- */
    mcp: {
      ready: "MCP Server ready for Claude Code",
    },

    /* ---- Widget ---- */
    widget: {
      label: "Widget",
      launching: "Launching...",
    },
  },

  fr: {
    /* ---- Header / Nav ---- */
    nav: {
      search: "Recherche",
      sources: "Sources",
      files: "Fichiers",
      back: "Retour à l'accueil",
    },

    /* ---- Hero / Landing ---- */
    hero: {
      tagline1: "Tout ce que vous avez cr\u00e9\u00e9.",
      tagline2: "\u00C0 une recherche pr\u00e8s.",
      ctrlKHint: "pour chercher de partout",
    },

    /* ---- Search ---- */
    search: {
      placeholder: "Rechercher dans vos contenus...",
      searching: "Recherche en cours...",
      noResults: "Aucun r\u00e9sultat",
      connectionFailed: "Connexion \u00e9chou\u00e9e",
      retry: "R\u00e9essayer",
    },

    /* ---- Stats pills ---- */
    stats: {
      repos: "Repos",
      files: "Fichiers",
      docs: "Docs",
      images: "Images",
      videos: "Vid\u00e9os",
    },

    /* ---- Filter bar ---- */
    filter: {
      all: "Tout",
      results: "r\u00e9sultats",
      github: "GitHub",
      image: "Image",
      video: "Vid\u00e9o",
      file: "Fichier",
      document: "Document",
      bookmark: "Favori",
      code: "Code",
      note: "Note",
      message: "Message",
      local: "Local",
      discord: "Discord",
      notion: "Notion",
      obsidian: "Obsidian",
      slack: "Slack",
      figma: "Figma",
      linear: "Linear",
      airtable: "Airtable",
      dropbox: "Dropbox",
      confluence: "Confluence",
      raindrop: "Raindrop",
      googleDrive: "Google Drive",
    },

    /* ---- Content card ---- */
    card: {
      open: "Ouvrir",
      preview: "Aper\u00e7u",
      move: "D\u00e9placer",
      copyPath: "Copier le chemin",
      openOnGithub: "Ouvrir sur GitHub",
      openInDiscord: "Ouvrir dans Discord",
      stars: "\u00e9toiles",
    },

    /* ---- File Manager ---- */
    fileManager: {
      favorites: "Favoris",
      pastePath: "Collez un chemin pour naviguer...",
      movedFiles: "{count} fichier(s) d\u00e9plac\u00e9(s)",
      undo: "Annuler",
      undoComplete: "Annulation termin\u00e9e",
      undoFailed: "Annulation \u00e9chou\u00e9e",
      rightClickToUnpin: "Clic droit pour d\u00e9\u00e9pingler",
      unpin: "D\u00e9\u00e9pingler",
      showFavorites: "Afficher les favoris",
      collapseSidebar: "R\u00e9duire le panneau",
      go: "GO",
      dragHints: "Glisser \u00B7 Ctrl+Clic \u00B7 Dbl-clic \u00B7 Clic droit",
      keyHints: "Suppr \u00B7 F2 \u00B7 Ctrl+C \u00B7 Entr\u00e9e",
    },

    /* ---- File Pane ---- */
    filePane: {
      name: "Nom",
      size: "Taille",
      modified: "Modifi\u00e9",
      goUp: "Remonter",
      newFolder: "Nouveau dossier",
      folderNamePrompt: "Nom du dossier :",
      filterFiles: "Filtrer les fichiers...",
      emptyFolder: "Dossier vide",
      items: "\u00e9l\u00e9ments",
      selected: "s\u00e9lectionn\u00e9(s)",
      dropHere: "D\u00e9poser ici",
      listView: "Affichage en liste",
      gridView: "Affichage en grille",
      delete: "Supprimer",
      confirmDelete: "Supprimer {count} \u00e9l\u00e9ment(s) ?",
      moving: "D\u00e9placement de {count} fichier(s)",
    },

    /* ---- File Preview ---- */
    filePreview: {
      preview: "Aper\u00e7u",
      open: "Ouvrir",
      move: "D\u00e9placer",
      copyPath: "Copier le chemin",
      loading: "Chargement...",
      noPreview: "Aper\u00e7u indisponible",
      openInApp: "Utilisez Ouvrir pour voir dans l\u2019appli par d\u00e9faut",
    },

    /* ---- Move Dialog ---- */
    moveDialog: {
      moveTo: "D\u00e9placer vers...",
      moving: "D\u00e9placement :",
      movingAction: "D\u00c9PLACEMENT...",
      moveHere: "D\u00e9placer ici",
      cancel: "Annuler",
      goUp: "Remonter",
      loading: "CHARGEMENT...",
      noSubdirectories: "Aucun sous-dossier",
    },

    /* ---- Command Palette ---- */
    commandPalette: {
      searchAnything: "Rechercher n\u2019importe quoi...",
      typeToSearch: "Tapez pour chercher",
      open: "OUVRIR",
      path: "CHEMIN",
      noResults: "Aucun r\u00e9sultat",
      navigate: "naviguer",
      openAction: "ouvrir",
      close: "fermer",
    },

    /* ---- Keyboard Help ---- */
    keyboard: {
      title: "Raccourcis clavier",
      navigation: "Navigation",
      fileManager: "Gestionnaire de fichiers",
      search: "Recherche",
      general: "G\u00e9n\u00e9ral",
      switchTabs: "Changer d\u2019onglet",
      cyclePanels: "Alterner entre les panneaux",
      navigateList: "Parcourir la liste",
      openSelected: "Ouvrir l\u2019\u00e9l\u00e9ment s\u00e9lectionn\u00e9",
      goParent: "Remonter au dossier parent",
      quickPreview: "Aper\u00e7u rapide",
      newFolder: "Nouveau dossier",
      rename: "Renommer la s\u00e9lection",
      deleteSelected: "Supprimer la s\u00e9lection",
      openPalette: "Ouvrir la palette de commandes",
      focusSearch: "Focus sur la barre de recherche",
      clearSearch: "Effacer la recherche / fermer",
      showHelp: "Afficher cette aide",
      reindex: "R\u00e9indexer les sources",
      openSettings: "Ouvrir les param\u00e8tres",
      closeModal: "Fermer la fen\u00eatre / overlay",
    },

    /* ---- Sources View ---- */
    sources: {
      title: "Sources",
      subtitle: "Connectez vos outils et laissez Trove tout indexer au m\u00eame endroit.",
      connected: "Connect\u00e9es",
      available: "Disponibles",
      comingSoon: "Bient\u00f4t disponibles",
      itemsIndexed: "\u00c9l\u00e9ments index\u00e9s",
      index: "Indexer",
      indexing: "Indexation...",
      disconnect: "D\u00e9connecter",
      connect: "Connecter",
      configure: "Configurer",
      next: "Suivant",
      save: "Enregistrer",
      back: "Retour",
      cancel: "Annuler",
      token: "Token",
      apiKey: "Cl\u00e9 API",
      tokenSet: "Token configur\u00e9",
      tokenMissing: "Token manquant",
      tokenProvided: "Token fourni",
      tokenRequired: "Le token est requis",
      requiresToken: "Token requis",
      pasteToken: "Collez votre token ici...",
      getToken: "Obtenir votre token",
      noConfigNeeded: "Aucune configuration suppl\u00e9mentaire requise. Cliquez sur Connecter pour terminer.",
      isSet: "est configur\u00e9",
      connecting: "Connexion...",
      connectedMsg: "Connect\u00e9 ! Cliquez sur Indexer pour lancer l\u2019indexation.",
      stepOf: "\u00c9tape {current} sur {total}",
      setupFailed: "\u00c9chec de la configuration",
      indexedItems: "{count} \u00e9l\u00e9ments index\u00e9s depuis {source}",
      doneItems: "Termin\u00e9 \u2014 {count} \u00e9l\u00e9ments index\u00e9s",
      disconnectConfirm: "D\u00e9connecter {id} ? Cela le retire de votre configuration.",
      disconnected: "{id} d\u00e9connect\u00e9",
      yes: "Oui",
      no: "Non",
    },

    /* ---- Boot Sequence ---- */
    boot: {
      name: "TROVE",
      tagline: "Vos contenus. Tous. Ici.",
    },

    /* ---- Status Bar ---- */
    status: {
      connected: "Connect\u00e9",
      offline: "Hors ligne",
      items: "\u00e9l\u00e9ments",
      justNow: "\u00e0 l\u2019instant",
      mAgo: "il y a {n} min",
      hAgo: "il y a {n} h",
      dAgo: "il y a {n} j",
    },

    /* ---- AI Answer ---- */
    ai: {
      badge: "IA",
    },

    /* ---- Toast ---- */
    toast: {
      undo: "Annuler",
    },

    /* ---- System Info ---- */
    system: {
      ram: "RAM",
      disk: "Disque",
      cpuCores: "C\u0153urs CPU",
      platform: "Plateforme",
      node: "Node",
    },

    /* ---- MCP Banner ---- */
    mcp: {
      ready: "Serveur MCP pr\u00eat pour Claude Code",
    },

    /* ---- Widget ---- */
    widget: {
      label: "Widget",
      launching: "Lancement...",
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Dot-notation resolver                                              */
/* ------------------------------------------------------------------ */

function resolve(obj: TranslationTree, path: string): string {
  const parts = path.split(".");
  let current: TranslationTree | TranslationLeaf = obj;

  for (const part of parts) {
    if (typeof current === "string") return path; // fallback: return key
    current = (current as TranslationBranch)[part] as TranslationTree | TranslationLeaf;
    if (current === undefined) return path;
  }

  return typeof current === "string" ? current : path;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const I18nContext = createContext<I18nContextValue | null>(null);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    storeLocale(newLocale);
  }, []);

  const t = useCallback(
    (key: string): string => resolve(translations[locale], key),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an <I18nProvider>");
  }
  return ctx;
}
