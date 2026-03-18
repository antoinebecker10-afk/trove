import { useState, useEffect, useCallback, useRef, type DragEvent, type CSSProperties } from "react";
import { colors, fonts, zIndex } from "../lib/theme";
import { api, type FileEntry } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** Track the width of a container element via ResizeObserver. */
function usePaneWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  folder: { icon: "\u25B7", color: colors.brand },
  image: { icon: "\u25C8", color: colors.cyan },
  video: { icon: "\u25B6", color: colors.purple },
  document: { icon: "\u25A3", color: colors.cyan },
  file: { icon: "\u25CB", color: colors.green },
};

type ViewMode = "list" | "grid";

interface ContextMenuState {
  x: number;
  y: number;
  item: FileEntry;
}

interface FilePaneProps {
  id: string;
  initialPath?: string;
  onDrop: (files: string[], targetDir: string) => void;
  onPreview: (path: string, type: string) => void;
  onAddFavorite?: (name: string, path: string) => void;
  refreshKey: number;
}

export function FilePane({ id, initialPath, onDrop, onPreview, onAddFavorite, refreshKey }: FilePaneProps) {
  const { t } = useI18n();
  const [currentPath, setCurrentPath] = useState(initialPath ?? "");
  const [items, setItems] = useState<FileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [dragCount, setDragCount] = useState(0);
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [removingPaths, setRemovingPaths] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const paneWidth = usePaneWidth(containerRef);

  const load = useCallback(async (path?: string) => {
    setLoading(true);
    setSelected(new Set());
    setContextMenu(null);
    try {
      const data = await api.files(path);
      setCurrentPath(data.current);
      setParentPath(data.parent);
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(initialPath); }, [initialPath, load]);
  useEffect(() => { if (refreshKey > 0) load(currentPath); }, [refreshKey, currentPath, load]);

  // Close context menu on click anywhere
  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle if this pane is focused
      if (!containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== containerRef.current) return;

      if (e.key === "Delete" && selected.size > 0) {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "F2" && selected.size === 1) {
        e.preventDefault();
        const path = [...selected][0];
        const item = items.find(i => i.path === path);
        if (item) startRename(item);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "c" && selected.size > 0) {
        e.preventDefault();
        const paths = [...selected].join("\n");
        navigator.clipboard.writeText(paths).catch((err: unknown) => console.warn("[trove]", err));
      } else if (e.key === "Enter" && selected.size === 1) {
        e.preventDefault();
        const path = [...selected][0];
        const item = items.find(i => i.path === path);
        if (item) {
          if (item.isDir) navigate(item.path);
          else onPreview(item.path, item.type);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selected, items, currentPath]);

  const navigate = (path: string) => {
    setFilter("");
    setContextMenu(null);
    load(path);
  };

  const toggleSelect = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        next.has(path) ? next.delete(path) : next.add(path);
      } else {
        next.clear();
        next.add(path);
      }
      return next;
    });
  };

  const handleDragStart = (e: DragEvent, item: FileEntry) => {
    const paths = selected.has(item.path) ? [...selected] : [item.path];
    e.dataTransfer.setData("application/trove-files", JSON.stringify(paths));
    e.dataTransfer.setData("text/plain", paths.join("\n"));
    e.dataTransfer.effectAllowed = "move";
    setDragCount(paths.length);

    // Custom drag image with count badge
    const badge = document.createElement("div");
    badge.textContent = `Moving ${paths.length} file${paths.length > 1 ? "s" : ""}`;
    badge.style.cssText = `
      position: fixed; top: -100px; left: -100px;
      padding: 4px 10px; border-radius: 4px;
      background: ${colors.brand}; color: #fff;
      font-family: ${fonts.mono}; font-size: 11px;
      font-weight: 600; white-space: nowrap;
    `;
    document.body.appendChild(badge);
    e.dataTransfer.setDragImage(badge, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(badge));
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setDragCount(0);
    const data = e.dataTransfer.getData("application/trove-files");
    if (data) {
      const files = JSON.parse(data) as string[];
      // Animate removal
      setRemovingPaths(new Set(files));
      setTimeout(() => setRemovingPaths(new Set()), 350);
      onDrop(files, currentPath);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDropOnDir = (e: DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDir(null);
    const data = e.dataTransfer.getData("application/trove-files");
    if (data) {
      const files = JSON.parse(data) as string[];
      setRemovingPaths(new Set(files));
      setTimeout(() => setRemovingPaths(new Set()), 350);
      onDrop(files, dirPath);
    }
  };

  const startRename = (item: FileEntry) => {
    setRenaming(item.path);
    setRenameValue(item.name);
    setContextMenu(null);
  };

  const confirmRename = async () => {
    if (!renaming || !renameValue.trim()) return;
    try {
      await api.renameFile(renaming, renameValue.trim());
      setRenaming(null);
      load(currentPath);
    } catch { /* ignore */ }
  };

  const handleNewFolder = async () => {
    const name = prompt("Folder name:");
    if (!name) return;
    const sep = currentPath.includes("/") ? "/" : "\\";
    await api.mkDir(currentPath + sep + name).catch((err: unknown) => console.warn("[trove]", err));
    load(currentPath);
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const ok = confirm(`Delete ${selected.size} item(s)?`);
    if (!ok) return;
    for (const p of selected) {
      await api.deleteFile(p).catch((err: unknown) => console.warn("[trove]", err));
    }
    load(currentPath);
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(item.path)) {
      setSelected(new Set([item.path]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handleContextAction = async (action: string, item: FileEntry) => {
    setContextMenu(null);
    switch (action) {
      case "open":
        if (item.isDir) navigate(item.path);
        else onPreview(item.path, item.type);
        break;
      case "rename":
        startRename(item);
        break;
      case "copyPath":
        navigator.clipboard.writeText(item.path).catch((err: unknown) => console.warn("[trove]", err));
        break;
      case "pin":
        if (onAddFavorite) {
          onAddFavorite(item.name, item.isDir ? item.path : item.path.substring(0, item.path.lastIndexOf(item.path.includes("/") ? "/" : "\\")));
        }
        break;
      case "delete":
        setSelected(new Set([item.path]));
        setTimeout(() => handleDelete(), 0);
        break;
    }
  };

  const displayed = filter
    ? items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  const pathParts = currentPath.split(/[\\/]/).filter(Boolean);

  // Calculate selected total size
  const selectedItems = items.filter(i => selected.has(i.path));
  const selectedSize = selectedItems.reduce((sum, i) => sum + (i.size || 0), 0);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onDragOver={handleDragOver}
      onDragLeave={() => { setDragOver(false); setDragOverDir(null); }}
      onDrop={handleDrop}
      onClick={() => setContextMenu(null)}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: dragOver ? "rgba(249,115,22,0.04)" : "transparent",
        border: dragOver
          ? `2px dashed ${colors.brand}88`
          : `1px solid ${colors.border}`,
        borderRadius: "6px",
        overflow: "hidden",
        transition: "all 0.2s ease",
        minWidth: 0,
        outline: "none",
        position: "relative",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "6px 8px",
          borderBottom: `1px solid ${colors.border}`,
          background: "rgba(255,255,255,0.02)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {parentPath && (
          <ToolBtn icon="\u2190" title={t("filePane.goUp")} onClick={() => navigate(parentPath)} />
        )}
        <ToolBtn icon="+" title={t("filePane.newFolder")} onClick={handleNewFolder} />
        {selected.size > 0 && (
          <ToolBtn icon="\u2715" title="Delete" color="#ef4444" onClick={handleDelete} />
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: "3px", alignItems: "center", flexShrink: 1, minWidth: 0 }}>
          {/* View toggle */}
          <div style={{
            display: "flex",
            border: `1px solid ${colors.border}`,
            borderRadius: "3px",
            overflow: "hidden",
          }}>
            <ViewToggle
              active={viewMode === "list"}
              icon="\u2630"
              title="List view"
              onClick={() => setViewMode("list")}
            />
            <ViewToggle
              active={viewMode === "grid"}
              icon="\u25A6"
              title="Grid view"
              onClick={() => setViewMode("grid")}
            />
          </div>

          <input
            type="text"
            placeholder={t("filePane.filterFiles")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: paneWidth < 300 ? "60px" : "90px",
              minWidth: "40px",
              flexShrink: 1,
              padding: "3px 6px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${colors.border}`,
              borderRadius: "3px",
              color: colors.text,
              fontSize: "10px",
              fontFamily: fonts.mono,
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = colors.brand + "66"; }}
            onBlur={e => { e.currentTarget.style.borderColor = colors.border; }}
          />
        </div>
      </div>

      {/* Breadcrumb */}
      <div
        style={{
          padding: "5px 8px",
          display: "flex",
          alignItems: "center",
          gap: "3px",
          flexWrap: "nowrap",
          whiteSpace: "nowrap",
          borderBottom: `1px solid ${colors.border}`,
          overflow: "auto",
          flexShrink: 0,
          scrollbarWidth: "none",
        }}
      >
        {pathParts.map((part, i) => {
          const fullPath = (currentPath.startsWith("/") ? "/" : "") +
            pathParts.slice(0, i + 1).join(currentPath.includes("/") ? "/" : "\\");
          const isLast = i === pathParts.length - 1;
          return (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
              <span
                onClick={() => navigate(fullPath)}
                style={{
                  cursor: "pointer",
                  padding: "2px 7px",
                  borderRadius: "10px",
                  fontSize: "10px",
                  fontFamily: fonts.mono,
                  fontWeight: isLast ? 600 : 400,
                  color: isLast ? colors.text : colors.textMuted,
                  background: isLast ? `${colors.brand}18` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isLast ? colors.brand + "30" : "transparent"}`,
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${colors.brand}25`;
                  e.currentTarget.style.color = colors.brand;
                  e.currentTarget.style.borderColor = colors.brand + "40";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isLast ? `${colors.brand}18` : "rgba(255,255,255,0.03)";
                  e.currentTarget.style.color = isLast ? colors.text : colors.textMuted;
                  e.currentTarget.style.borderColor = isLast ? colors.brand + "30" : "transparent";
                }}
              >
                {part}
              </span>
              {!isLast && (
                <span style={{ color: colors.textGhost, fontSize: "9px" }}>\u203A</span>
              )}
            </span>
          );
        })}
      </div>

      {/* File list / grid */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {loading ? (
          <SkeletonLoader viewMode={viewMode} />
        ) : displayed.length === 0 ? (
          <EmptyState />
        ) : viewMode === "list" ? (
          displayed.map((item, index) => (
            <ListRow
              key={item.path}
              item={item}
              index={index}
              isSelected={selected.has(item.path)}
              isRemoving={removingPaths.has(item.path)}
              isDragTarget={dragOverDir === item.path}
              paneWidth={paneWidth}
              renaming={renaming}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameConfirm={confirmRename}
              onRenameCancel={() => setRenaming(null)}
              onDragStart={(e) => handleDragStart(e, item)}
              onDragOverDir={() => { if (item.isDir) setDragOverDir(item.path); }}
              onDragLeaveDir={() => setDragOverDir(null)}
              onDropOnDir={(e) => handleDropOnDir(e, item.path)}
              onClick={(e) => {
                if (item.isDir) navigate(item.path);
                else toggleSelect(item.path, e);
              }}
              onDoubleClick={() => { if (!item.isDir) onPreview(item.path, item.type); }}
              onContextMenu={(e) => handleContextMenu(e, item)}
            />
          ))
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${paneWidth < 250 ? "80px" : "100px"}, 1fr))`,
            gap: "6px",
            padding: "8px",
          }}>
            {displayed.map((item) => (
              <GridTile
                key={item.path}
                item={item}
                isSelected={selected.has(item.path)}
                isRemoving={removingPaths.has(item.path)}
                onClick={(e) => {
                  if (item.isDir) navigate(item.path);
                  else toggleSelect(item.path, e);
                }}
                onDoubleClick={() => { if (!item.isDir) onPreview(item.path, item.type); }}
                onContextMenu={(e) => handleContextMenu(e, item)}
                onDragStart={(e) => handleDragStart(e, item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: "4px 10px",
          borderTop: `1px solid ${colors.border}`,
          fontSize: "9px",
          fontFamily: fonts.mono,
          color: colors.textGhost,
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexShrink: 0,
          flexWrap: "wrap",
          background: "rgba(255,255,255,0.015)",
        }}
      >
        <span>{displayed.length} {t("filePane.items")}</span>
        {selected.size > 0 && (
          <>
            <span style={{ color: colors.brand }}>{selected.size} {t("filePane.selected")}</span>
            {selectedSize > 0 && (
              <span style={{ color: colors.textDim }}>{formatSize(selectedSize)}</span>
            )}
          </>
        )}
      </div>

      {/* Drop zone overlay */}
      {dragOver && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(249,115,22,0.06)",
          border: `2px dashed ${colors.brand}88`,
          borderRadius: "6px",
          zIndex: 50,
          pointerEvents: "none",
        }}>
          <span style={{
            fontSize: "12px",
            fontFamily: fonts.mono,
            color: colors.brand,
            opacity: 0.8,
          }}>
            {t("filePane.dropHere")}
          </span>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenuOverlay
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          containerRef={containerRef}
          onAction={(action) => handleContextAction(action, contextMenu.item)}
        />
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function ToolBtn({ icon, color, title, onClick }: { icon: string; color?: string; title?: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        fontSize: "11px",
        fontFamily: fonts.mono,
        padding: "2px 7px",
        background: `${color ?? colors.textDim}12`,
        border: `1px solid ${color ?? colors.textDim}33`,
        borderRadius: "3px",
        color: color ?? colors.textMuted,
        cursor: "pointer",
        transition: "all 0.15s",
        lineHeight: "16px",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `${color ?? colors.brand}25`;
        e.currentTarget.style.borderColor = `${color ?? colors.brand}55`;
        e.currentTarget.style.color = color ?? colors.brand;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = `${color ?? colors.textDim}12`;
        e.currentTarget.style.borderColor = `${color ?? colors.textDim}33`;
        e.currentTarget.style.color = color ?? colors.textMuted;
      }}
    >
      {icon}
    </button>
  );
}

function ViewToggle({ active, icon, title, onClick }: { active: boolean; icon: string; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        fontSize: "10px",
        padding: "2px 6px",
        background: active ? `${colors.brand}20` : "transparent",
        border: "none",
        color: active ? colors.brand : colors.textDim,
        cursor: "pointer",
        fontFamily: fonts.mono,
        transition: "all 0.15s",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = colors.textMuted; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = colors.textDim; }}
    >
      {icon}
    </button>
  );
}

interface ListRowProps {
  item: FileEntry;
  index: number;
  isSelected: boolean;
  isRemoving: boolean;
  isDragTarget: boolean;
  paneWidth: number;
  renaming: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOverDir: () => void;
  onDragLeaveDir: () => void;
  onDropOnDir: (e: DragEvent<HTMLDivElement>) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ListRow({
  item, index, isSelected, isRemoving, isDragTarget, paneWidth,
  renaming, renameValue, onRenameChange, onRenameConfirm, onRenameCancel,
  onDragStart, onDragOverDir, onDragLeaveDir, onDropOnDir,
  onClick, onDoubleClick, onContextMenu,
}: ListRowProps) {
  const meta = TYPE_ICONS[item.type] ?? TYPE_ICONS.file;
  const isImg = IMAGE_EXTS.has(item.ext);
  const isEven = index % 2 === 0;
  const showModified = paneWidth >= 400;
  const showSize = paneWidth >= 300;
  const showPath = paneWidth >= 350;

  const baseRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "5px 10px",
    cursor: item.isDir ? "pointer" : "grab",
    background: isSelected
      ? `${colors.brand}18`
      : isDragTarget
        ? `${colors.brand}12`
        : isEven
          ? "transparent"
          : "rgba(255,255,255,0.012)",
    borderBottom: "1px solid rgba(255,255,255,0.025)",
    borderLeft: isSelected
      ? `2px solid ${colors.brand}`
      : isDragTarget
        ? `2px dashed ${colors.brand}88`
        : "2px solid transparent",
    transition: "all 0.2s ease",
    userSelect: "none" as const,
    opacity: isRemoving ? 0 : 1,
    transform: isRemoving ? "translateX(-20px)" : "none",
  };

  return (
    <div
      draggable={!item.isDir}
      onDragStart={onDragStart as unknown as React.DragEventHandler}
      onDragOver={item.isDir ? (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); onDragOverDir(); } : undefined}
      onDragLeave={item.isDir ? onDragLeaveDir : undefined}
      onDrop={item.isDir ? (onDropOnDir as unknown as React.DragEventHandler) : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={baseRowStyle}
      onMouseEnter={(e) => {
        if (!isSelected && !isDragTarget) {
          e.currentTarget.style.background = "rgba(255,255,255,0.035)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected && !isDragTarget) {
          e.currentTarget.style.background = isEven ? "transparent" : "rgba(255,255,255,0.012)";
        }
      }}
    >
      {/* Selection checkmark */}
      {isSelected && (
        <span style={{
          fontSize: "10px",
          color: colors.brand,
          flexShrink: 0,
          width: "12px",
          textAlign: "center",
        }}>
          \u2713
        </span>
      )}
      {!isSelected && <span style={{ width: "12px", flexShrink: 0 }} />}

      {/* Thumbnail or icon */}
      {isImg ? (
        <img
          src={api.fileServeUrl(item.path)}
          alt=""
          loading="lazy"
          style={{ width: "28px", height: "28px", objectFit: "cover", borderRadius: "3px", flexShrink: 0 }}
        />
      ) : (
        <span style={{
          fontSize: "12px",
          color: meta.color,
          fontFamily: fonts.mono,
          width: "28px",
          textAlign: "center",
          flexShrink: 0,
        }}>
          {meta.icon}
        </span>
      )}

      {/* Name */}
      {renaming === item.path ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameConfirm}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameConfirm();
            if (e.key === "Escape") onRenameCancel();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            padding: "2px 6px",
            background: "rgba(255,255,255,0.06)",
            border: `1px solid ${colors.brand}66`,
            borderRadius: "3px",
            color: "#fff",
            fontSize: "11px",
            fontFamily: fonts.mono,
            outline: "none",
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            fontSize: "11px",
            fontFamily: fonts.mono,
            color: item.isDir ? colors.brand : colors.text,
            fontWeight: item.isDir ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.name}
        </span>
      )}

      {/* Modified date — hidden when pane < 400px */}
      {showModified && item.modified && (
        <span style={{
          fontSize: "9px",
          color: colors.textGhost,
          fontFamily: fonts.mono,
          flexShrink: 0,
          minWidth: "50px",
          textAlign: "right",
        }}>
          {formatRelativeTime(item.modified)}
        </span>
      )}

      {/* Path / URL — hidden when pane < 350px */}
      {showPath && (
        <span
          title={`Click to copy: ${item.path}`}
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(item.path).catch((err: unknown) => console.warn("[trove]", err));
          }}
          style={{
            fontSize: "8px",
            color: colors.textGhost,
            fontFamily: fonts.mono,
            flexShrink: 1,
            minWidth: "40px",
            maxWidth: paneWidth < 500 ? "100px" : "180px",
            textAlign: "right",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "copy",
            direction: "rtl",
            transition: "color 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.cyan; }}
          onMouseLeave={e => { e.currentTarget.style.color = colors.textGhost; }}
        >
          {item.path}
        </span>
      )}

      {/* Size — hidden when pane < 300px */}
      {showSize && !item.isDir && (
        <span style={{
          fontSize: "9px",
          color: colors.textGhost,
          fontFamily: fonts.mono,
          flexShrink: 0,
          minWidth: "48px",
          textAlign: "right",
        }}>
          {formatSize(item.size)}
        </span>
      )}
    </div>
  );
}

function GridTile({ item, isSelected, isRemoving, onClick, onDoubleClick, onContextMenu, onDragStart }: {
  item: FileEntry;
  isSelected: boolean;
  isRemoving: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const meta = TYPE_ICONS[item.type] ?? TYPE_ICONS.file;
  const isImg = IMAGE_EXTS.has(item.ext);

  return (
    <div
      draggable={!item.isDir}
      onDragStart={onDragStart as unknown as React.DragEventHandler}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        padding: "10px 6px 8px",
        borderRadius: "6px",
        cursor: item.isDir ? "pointer" : "grab",
        background: isSelected ? `${colors.brand}18` : "rgba(255,255,255,0.015)",
        border: isSelected ? `1px solid ${colors.brand}40` : "1px solid transparent",
        transition: "all 0.2s ease",
        userSelect: "none",
        opacity: isRemoving ? 0 : 1,
        transform: isRemoving ? "scale(0.8)" : "none",
        position: "relative",
        minWidth: 0,
        overflow: "hidden",
      }}
      onMouseEnter={e => {
        if (!isSelected) {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.borderColor = colors.border;
        }
      }}
      onMouseLeave={e => {
        if (!isSelected) {
          e.currentTarget.style.background = "rgba(255,255,255,0.015)";
          e.currentTarget.style.borderColor = "transparent";
        }
      }}
    >
      {isImg ? (
        <img
          src={api.fileServeUrl(item.path)}
          alt=""
          loading="lazy"
          style={{
            width: "56px",
            height: "56px",
            objectFit: "cover",
            borderRadius: "4px",
          }}
        />
      ) : (
        <span style={{
          fontSize: "24px",
          color: meta.color,
          lineHeight: "56px",
        }}>
          {meta.icon}
        </span>
      )}
      <span
        title={item.name}
        style={{
          fontSize: "9px",
          fontFamily: fonts.mono,
          color: item.isDir ? colors.brand : colors.text,
          fontWeight: item.isDir ? 600 : 400,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
          maxWidth: "100%",
          padding: "0 2px",
          boxSizing: "border-box",
        }}
      >
        {item.name}
      </span>
      <span
        title={`Click to copy: ${item.path}`}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(item.path).catch((err: unknown) => console.warn("[trove]", err));
        }}
        style={{
          fontSize: "7px",
          fontFamily: fonts.mono,
          color: colors.textGhost,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
          maxWidth: "100%",
          padding: "0 2px",
          boxSizing: "border-box",
          textAlign: "center",
          cursor: "copy",
          direction: "rtl",
          transition: "color 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.cyan; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textGhost; }}
      >
        {item.path}
      </span>
      {isSelected && (
        <span style={{
          position: "absolute",
          top: "4px",
          right: "4px",
          fontSize: "9px",
          color: colors.brand,
        }}>
          \u2713
        </span>
      )}
    </div>
  );
}

function SkeletonLoader({ viewMode }: { viewMode: ViewMode }) {
  const rows = viewMode === "list" ? 8 : 6;
  if (viewMode === "grid") {
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
        gap: "6px",
        padding: "8px",
      }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
            padding: "12px",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.015)",
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "4px",
              background: `rgba(255,255,255,${0.03 + (i % 3) * 0.01})`,
              animation: "skeletonPulse 1.5s ease-in-out infinite",
              animationDelay: `${i * 0.1}s`,
            }} />
            <div style={{
              width: "60px",
              height: "8px",
              borderRadius: "4px",
              background: `rgba(255,255,255,${0.03 + (i % 3) * 0.01})`,
              animation: "skeletonPulse 1.5s ease-in-out infinite",
              animationDelay: `${i * 0.1 + 0.05}s`,
            }} />
          </div>
        ))}
        <style>{`
          @keyframes skeletonPulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "7px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.025)",
        }}>
          <div style={{ width: "12px" }} />
          <div style={{
            width: "28px",
            height: "28px",
            borderRadius: "3px",
            background: `rgba(255,255,255,${0.03 + (i % 3) * 0.01})`,
            animation: "skeletonPulse 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.1}s`,
            flexShrink: 0,
          }} />
          <div style={{
            flex: 1,
            height: "10px",
            borderRadius: "5px",
            background: `rgba(255,255,255,${0.03 + (i % 3) * 0.01})`,
            animation: "skeletonPulse 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.1 + 0.05}s`,
            maxWidth: `${120 + (i * 30) % 100}px`,
          }} />
          <div style={{
            width: "40px",
            height: "8px",
            borderRadius: "4px",
            background: "rgba(255,255,255,0.025)",
            animation: "skeletonPulse 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.1 + 0.1}s`,
          }} />
        </div>
      ))}
      <style>{`
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      minHeight: "120px",
      gap: "8px",
      color: colors.textGhost,
    }}>
      <span style={{ fontSize: "28px", opacity: 0.3 }}>{"\u2B07"}</span>
      <span style={{
        fontSize: "11px",
        fontFamily: fonts.mono,
        color: colors.textDim,
      }}>
        Drop files here
      </span>
      <span style={{
        fontSize: "9px",
        fontFamily: fonts.mono,
        color: colors.textGhost,
      }}>
        or navigate to a folder
      </span>
    </div>
  );
}

function ContextMenuOverlay({ x, y, item, containerRef, onAction }: {
  x: number;
  y: number;
  item: FileEntry;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAction: (action: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Position relative to the container
  const rect = containerRef.current?.getBoundingClientRect();
  const relX = rect ? x - rect.left : x;
  const relY = rect ? y - rect.top : y;

  const menuItems = [
    { key: "open", label: item.isDir ? "Open Folder" : "Preview", icon: "\u25B6" },
    { key: "pin", label: "Pin to Favorites", icon: "\u2606" },
    { key: "rename", label: "Rename", icon: "\u270E" },
    { key: "copyPath", label: "Copy Path", icon: "\u2398" },
    { key: "delete", label: "Delete", icon: "\u2715", color: "#ef4444" },
  ];

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: `${relY}px`,
        left: `${relX}px`,
        zIndex: zIndex.dropdown,
        background: "#1a1a1a",
        border: `1px solid ${colors.border}`,
        borderRadius: "6px",
        padding: "4px 0",
        minWidth: "150px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        animation: "menuFadeIn 0.1s ease",
      }}
    >
      {menuItems.map(({ key, label, icon, color }) => (
        <div
          key={key}
          onClick={() => onAction(key)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 12px",
            fontSize: "11px",
            fontFamily: fonts.mono,
            color: color ?? colors.text,
            cursor: "pointer",
            transition: "background 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = `${colors.brand}15`; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ width: "14px", textAlign: "center", fontSize: "10px", opacity: 0.7 }}>{icon}</span>
          <span>{label}</span>
          {key === "rename" && (
            <span style={{ marginLeft: "auto", fontSize: "9px", color: colors.textGhost }}>F2</span>
          )}
          {key === "delete" && (
            <span style={{ marginLeft: "auto", fontSize: "9px", color: colors.textGhost }}>Del</span>
          )}
          {key === "copyPath" && (
            <span style={{ marginLeft: "auto", fontSize: "9px", color: colors.textGhost }}>Ctrl+C</span>
          )}
        </div>
      ))}
      <style>{`
        @keyframes menuFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

/* ── Utilities ────────────────────────────────────────────────────── */

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return "yesterday";
    if (diffDay < 7) return `${diffDay}d ago`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
    if (diffDay < 365) return `${Math.floor(diffDay / 30)}mo ago`;
    return `${Math.floor(diffDay / 365)}y ago`;
  } catch {
    return "";
  }
}
