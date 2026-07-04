"use client";

import React, { useMemo, useState } from "react";

interface CitationAnswerProps {
  answer: string;
  citations?: Array<{ fileId: string; filename: string; index: number }>;
  annotations?: Array<{ text: string; fileId: string; filename: string; index: number }>;
}

interface UniqueFile {
  fileId: string;
  filename: string;
  displayIndex: number;
}

// Matches citation markers emitted by the model, e.g. 【1†source】 or 【1】.
const CITATION_MARKER = /【\d+(?:†[^】]*)?】/g;

function extractMarkerNumber(marker: string): number | null {
  const match = marker.match(/【(\d+)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

// Simple inline markdown parser for bold (**) and italics (*)
function renderInlineMarkdown(text: string, baseKey: string): React.ReactNode {
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);

  return boldParts.map((boldPart, bIdx) => {
    const isBold = boldPart.startsWith("**") && boldPart.endsWith("**");
    const cleanBoldText = isBold ? boldPart.slice(2, -2) : boldPart;

    const italicParts = cleanBoldText.split(/(\*[^*]+\*)/g);
    const renderedItalics = italicParts.map((italicPart, iIdx) => {
      const isItalic = italicPart.startsWith("*") && italicPart.endsWith("*");
      const cleanItalicText = isItalic ? italicPart.slice(1, -1) : italicPart;

      if (isItalic) {
        return (
          <em key={`${baseKey}-${bIdx}-${iIdx}`} className="italic font-medium">
            {cleanItalicText}
          </em>
        );
      }
      return cleanItalicText;
    });

    if (isBold) {
      return (
        <strong key={`${baseKey}-${bIdx}`} className="font-bold text-foreground">
          {renderedItalics}
        </strong>
      );
    }
    return <React.Fragment key={`${baseKey}-${bIdx}`}>{renderedItalics}</React.Fragment>;
  });
}

export function CitationAnswer({
  answer,
  citations = [],
  annotations = [],
}: CitationAnswerProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Build a stable mapping from context-block number (N in 【N†source】) to a
  // unique file, and assign each unique file a sequential 1-based display index.
  const { uniqueFilesList, markerToDisplayIndex } = useMemo(() => {
    const filesMap = new Map<string, UniqueFile>();
    const list: UniqueFile[] = [];
    const markerMap = new Map<number, number>();
    let nextIndex = 1;

    // annotations carry chunk index (0-based). The in-text marker number is index + 1.
    const sorted = [...annotations].sort((a, b) => a.index - b.index);

    for (const annotation of sorted) {
      const key = `${annotation.fileId}:${annotation.filename}`;
      let fileInfo = filesMap.get(key);
      if (!fileInfo) {
        fileInfo = {
          fileId: annotation.fileId,
          filename: annotation.filename,
          displayIndex: nextIndex++,
        };
        filesMap.set(key, fileInfo);
        list.push(fileInfo);
      }
      markerMap.set(annotation.index + 1, fileInfo.displayIndex);
    }

    // Fallback: if annotations are missing but citations exist, expose the files
    // so the footer still lists sources even without inline markers.
    if (list.length === 0 && citations.length > 0) {
      const sortedCitations = [...citations].sort((a, b) => a.index - b.index);
      for (const citation of sortedCitations) {
        const key = `${citation.fileId}:${citation.filename}`;
        if (!filesMap.has(key)) {
          const fileInfo = {
            fileId: citation.fileId,
            filename: citation.filename,
            displayIndex: nextIndex++,
          };
          filesMap.set(key, fileInfo);
          list.push(fileInfo);
        }
      }
    }

    return { uniqueFilesList: list, markerToDisplayIndex: markerMap };
  }, [annotations, citations]);

  if (!answer) {
    return <p className="text-slate-400 italic">No answer provided.</p>;
  }

  function renderCitationPill(displayIndex: number, key: string) {
    const fileInfo = uniqueFilesList.find((f) => f.displayIndex === displayIndex);
    const isHovered = hoveredIndex === displayIndex;
    return (
      <button
        key={key}
        type="button"
        className={`inline-flex items-center justify-center font-mono text-[9px] font-bold mx-0.5 px-1.5 py-0.2 rounded-full border transition-all duration-150 cursor-pointer align-super ${
          isHovered
            ? "bg-accent-teal text-white border-accent-teal scale-110 shadow-sm"
            : "bg-input-theme dark:bg-slate-800 text-slate-500 dark:text-slate-350 border-border-theme hover:bg-border-theme hover:text-slate-700 dark:hover:text-slate-100"
        }`}
        onMouseEnter={() => setHoveredIndex(displayIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
        title={fileInfo?.filename ?? `Source ${displayIndex}`}
      >
        {displayIndex}
      </button>
    );
  }

  // Parse a single line: convert 【N†source】 markers into pills, highlight the
  // sentence that precedes a citation, and flag [not in files] statements.
  function renderLineWithCitations(line: string, lineIdx: number): React.ReactNode {
    const parts = line.split(CITATION_MARKER);
    const markers = line.match(CITATION_MARKER) ?? [];
    const elements: React.ReactNode[] = [];
    let lastPillDisplayIndex = -1;

    parts.forEach((textPart, i) => {
      // Determine citation markers that appear immediately after this text part.
      const markerDisplayIndexes: number[] = [];
      if (i < markers.length) {
        const markerNumber = extractMarkerNumber(markers[i]);
        if (markerNumber !== null) {
          const displayIndex = markerToDisplayIndex.get(markerNumber) ?? null;
          if (displayIndex !== null) {
            markerDisplayIndexes.push(displayIndex);
          }
        }
      }

      if (textPart) {
        const followedByCitation = markerDisplayIndexes.length > 0;
        const firstCitationIndex = followedByCitation ? markerDisplayIndexes[0] : -1;

        const sentences = textPart.split(/(?<=[.?!])\s+/);
        sentences.forEach((sentenceText, sIdx) => {
          const isLastSentence = sIdx === sentences.length - 1;
          const cited = followedByCitation && isLastSentence;

          const notInFilesRegex = /\s*[[(](not in files|not in file|outside knowledge|ungrounded)[\])]\s*/i;
          const isExplicitlyNotInFiles = notInFilesRegex.test(sentenceText);
          const cleanSentenceText = sentenceText.replace(notInFilesRegex, "").trim();

          if (!cleanSentenceText) return;

          const contentElement = renderInlineMarkdown(
            cleanSentenceText,
            `txt-${lineIdx}-${i}-${sIdx}`,
          );

          if (cited) {
            const isHovered = hoveredIndex === firstCitationIndex;
            elements.push(
              <span
                key={`span-${lineIdx}-${i}-${sIdx}`}
                className={`rounded px-0.5 border-b cursor-pointer transition-all duration-200 ${
                  isHovered
                    ? "bg-accent-teal/20 dark:bg-accent-teal/25 border-accent-teal text-slate-900 dark:text-white"
                    : "bg-accent-teal/5 dark:bg-accent-teal/10 border-dashed border-accent-teal/30 hover:bg-accent-teal/15 dark:hover:bg-accent-teal/20"
                }`}
                onMouseEnter={() => setHoveredIndex(firstCitationIndex)}
                onMouseLeave={() => setHoveredIndex(null)}
                title={`Grounded in source [${firstCitationIndex}]`}
              >
                {contentElement}
              </span>,
            );
          } else if (isExplicitlyNotInFiles) {
            elements.push(
              <span
                key={`span-not-in-files-${lineIdx}-${i}-${sIdx}`}
                className="rounded px-0.5 border-b border-dashed border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10 text-rose-600 dark:text-rose-350 cursor-help transition-all duration-200 hover:bg-rose-500/15"
                title="This statement is not found in the knowledge base (outside knowledge)."
              >
                {contentElement}
              </span>,
            );
          } else {
            elements.push(
              <React.Fragment key={`frag-${lineIdx}-${i}-${sIdx}`}>
                {contentElement}{" "}
              </React.Fragment>,
            );
          }
        });
      }

      // Render pill(s) for the marker after this text part, de-duplicating
      // consecutive markers that point to the same file.
      for (const displayIndex of markerDisplayIndexes) {
        if (displayIndex === lastPillDisplayIndex) {
          continue;
        }
        elements.push(renderCitationPill(displayIndex, `cit-${lineIdx}-${i}-${displayIndex}`));
        lastPillDisplayIndex = displayIndex;
      }

      // Reset dedup tracker when the next segment has actual text content.
      if (i + 1 < parts.length && parts[i + 1]) {
        lastPillDisplayIndex = -1;
      }
    });

    return elements;
  }

  // Render content line by line, recognizing lists, headers, and paragraphs.
  const lines = answer.split("\n");
  const renderedElements: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];
  let currentListType: "bullet" | "ordered" | null = null;
  let currentListKey = 0;

  function flushList() {
    if (currentListItems.length === 0) return;
    if (currentListType === "bullet") {
      renderedElements.push(
        <ul key={`ul-${currentListKey}`} className="list-disc ml-5 pl-1 my-2 space-y-1">
          {currentListItems}
        </ul>,
      );
    } else if (currentListType === "ordered") {
      renderedElements.push(
        <ol key={`ol-${currentListKey}`} className="list-decimal ml-5 pl-1 my-2 space-y-1">
          {currentListItems}
        </ol>,
      );
    }
    currentListItems = [];
    currentListType = null;
    currentListKey++;
  }

  lines.forEach((line, lineIdx) => {
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);

    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      const cleanLine = headerMatch[2];
      const headerContent = renderLineWithCitations(cleanLine, lineIdx);

      switch (level) {
        case 1:
          renderedElements.push(
            <h1 key={`h1-${lineIdx}`} className="text-xl font-bold text-slate-900 dark:text-white mt-4 mb-2 first:mt-0 leading-tight">
              {headerContent}
            </h1>,
          );
          break;
        case 2:
          renderedElements.push(
            <h2 key={`h2-${lineIdx}`} className="text-lg font-bold text-slate-900 dark:text-white mt-3.5 mb-1.5 first:mt-0 leading-snug">
              {headerContent}
            </h2>,
          );
          break;
        case 3:
        default:
          renderedElements.push(
            <h3 key={`h3-${lineIdx}`} className="text-base font-semibold text-slate-900 dark:text-white mt-3 mb-1.5 first:mt-0 leading-snug">
              {headerContent}
            </h3>,
          );
          break;
      }
    } else if (bulletMatch) {
      if (currentListType !== "bullet") {
        flushList();
        currentListType = "bullet";
      }
      const cleanLine = bulletMatch[2];
      currentListItems.push(
        <li key={`li-${lineIdx}`} className="text-foreground leading-relaxed">
          {renderLineWithCitations(cleanLine, lineIdx)}
        </li>,
      );
    } else if (orderedMatch) {
      if (currentListType !== "ordered") {
        flushList();
        currentListType = "ordered";
      }
      const cleanLine = orderedMatch[3];
      const val = parseInt(orderedMatch[2], 10);
      currentListItems.push(
        <li key={`li-${lineIdx}`} value={val} className="text-foreground leading-relaxed">
          {renderLineWithCitations(cleanLine, lineIdx)}
        </li>,
      );
    } else {
      flushList();
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        renderedElements.push(
          <p key={`p-${lineIdx}`} className="my-2 text-foreground leading-relaxed">
            {renderLineWithCitations(line, lineIdx)}
          </p>,
        );
      } else {
        renderedElements.push(<div key={`spacer-${lineIdx}`} className="h-2" />);
      }
    }
  });

  flushList();

  const hasNotInFilesMarker = /\s*[[(](not in files|not in file|outside knowledge|ungrounded)[\])]\s*/i.test(answer);

  return (
    <div className="space-y-4">
      {/* RENDERED TEXT AND CITATION BADGES */}
      <div className="text-sm text-foreground space-y-1">
        {renderedElements}
      </div>

      {/* LEGEND / STATUS INDICATOR */}
      {(uniqueFilesList.length > 0 || hasNotInFilesMarker) && (
        <div className="flex flex-wrap gap-4 items-center text-[10px] uppercase font-bold tracking-wider text-slate-500 pt-3 border-t border-border-theme mt-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent-teal" />
            Grounded in Files (Cited)
          </span>
          {hasNotInFilesMarker && (
            <span className="flex items-center gap-1.5 text-rose-500">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Not in Files (Outside Knowledge)
            </span>
          )}
        </div>
      )}

      {/* CITATIONS LIST */}
      {uniqueFilesList.length > 0 && (
        <div className="pt-3 border-t border-border-theme mt-4">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">
            Citations
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {uniqueFilesList.map((file) => {
              const isHovered = hoveredIndex === file.displayIndex;
              return (
                <div
                  key={file.fileId}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all duration-150 ${
                    isHovered
                      ? "border-accent-teal/40 bg-accent-teal/10 dark:bg-accent-teal/5 text-accent-teal translate-x-0.5 shadow-sm"
                      : "border-border-theme bg-card-bg text-slate-650 dark:text-slate-300"
                  }`}
                  onMouseEnter={() => setHoveredIndex(file.displayIndex)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  title={`File ID: ${file.fileId}`}
                >
                  <span className="font-mono font-bold text-[10px] rounded bg-input-theme px-1.5 py-0.5 text-slate-500 dark:text-slate-400 border border-border-theme">
                    [{file.displayIndex}]
                  </span>
                  <svg className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate font-medium">{file.filename}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
