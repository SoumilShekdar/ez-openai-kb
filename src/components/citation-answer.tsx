"use client";

import React, { useState } from "react";

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

// Simple inline markdown parser for bold (**) and italics (*)
function renderInlineMarkdown(text: string, baseKey: string): React.ReactNode {
  // Split by bold patterns: **text**
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  
  return boldParts.map((boldPart, bIdx) => {
    const isBold = boldPart.startsWith("**") && boldPart.endsWith("**");
    const cleanBoldText = isBold ? boldPart.slice(2, -2) : boldPart;

    // Split by italic patterns: *text*
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

  if (!answer) {
    return <p className="text-slate-400 italic">No answer provided.</p>;
  }

  // 1. Group unique files and assign sequential 1-based display indices
  const uniqueFilesMap = new Map<string, UniqueFile>();
  const uniqueFilesList: UniqueFile[] = [];
  let nextIndex = 1;

  // Sort annotations by index ascending to process them in the order they appear in the text
  const sortedAnnotationsAsc = [...annotations].sort((a, b) => a.index - b.index);

  sortedAnnotationsAsc.forEach((ann) => {
    const key = `${ann.fileId}:${ann.filename}`;
    if (!uniqueFilesMap.has(key)) {
      const fileInfo = {
        fileId: ann.fileId,
        filename: ann.filename,
        displayIndex: nextIndex++,
      };
      uniqueFilesMap.set(key, fileInfo);
      uniqueFilesList.push(fileInfo);
    }
  });

  // Preprocess: Insert citation markers back into the text using annotation indices
  let reconstructedAnswer = answer;
  // Sort descending by index to prevent index shifting during insertion
  const sortedAnnotationsDesc = [...annotations].sort((a, b) => b.index - a.index);
  
  sortedAnnotationsDesc.forEach((ann) => {
    const fileInfo = uniqueFilesMap.get(`${ann.fileId}:${ann.filename}`);
    if (fileInfo) {
      const marker = `【${fileInfo.displayIndex}】`;
      const idx = ann.index;
      if (idx >= 0 && idx <= reconstructedAnswer.length) {
        reconstructedAnswer =
          reconstructedAnswer.slice(0, idx) +
          marker +
          reconstructedAnswer.slice(idx);
      }
    }
  });

  // 2. Helper to parse a single line for citation markers, cited sentences, and inline markdown
  function renderLineWithCitations(
    line: string,
    lineIdx: number
  ): React.ReactNode {
    const regex = /(【\d+】)/g;
    const parts = line.split(regex);
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      const match = part.match(/【(\d+)】/);
      let citationInfo = null;

      if (match) {
        const displayIndex = parseInt(match[1], 10);
        citationInfo = uniqueFilesList.find((f) => f.displayIndex === displayIndex);
      }

      if (citationInfo) {
        const displayIndex = citationInfo.displayIndex;
        const isHovered = hoveredIndex === displayIndex;
        elements.push(
          <button
            key={`cit-${lineIdx}-${i}`}
            type="button"
            className={`inline-flex items-center justify-center font-mono text-[9px] font-bold mx-0.5 px-1.5 py-0.2 rounded-full border transition-all duration-150 cursor-pointer align-super ${
              isHovered
                ? "bg-accent-teal text-white border-accent-teal scale-110 shadow-sm"
                : "bg-input-theme dark:bg-slate-800 text-slate-500 dark:text-slate-350 border-border-theme hover:bg-border-theme hover:text-slate-700 dark:hover:text-slate-100"
            }`}
            onMouseEnter={() => setHoveredIndex(displayIndex)}
            onMouseLeave={() => setHoveredIndex(null)}
            title={citationInfo.filename}
          >
            {displayIndex}
          </button>
        );
      } else {
        // It's a text part. Is it immediately followed by a citation?
        const nextPart = parts[i + 1];
        let followedByCitation = false;
        let nextCitationIndex = -1;

        if (nextPart) {
          const nextMatch = nextPart.match(/【(\d+)】/);
          if (nextMatch) {
            const displayIndex = parseInt(nextMatch[1], 10);
            const fileInfo = uniqueFilesList.find((f) => f.displayIndex === displayIndex);
            if (fileInfo) {
              followedByCitation = true;
              nextCitationIndex = fileInfo.displayIndex;
            }
          }
        }

        // Split the text part into sentences
        const sentences = part.split(/(?<=[.?!])\s+/);
        sentences.forEach((sentenceText, sIdx) => {
          const isLastSentence = sIdx === sentences.length - 1;
          const cited = followedByCitation && isLastSentence;

          // Check for "not in files" markers (case-insensitive)
          const notInFilesRegex = /\s*[\[\(](not in files|not in file|outside knowledge|ungrounded)[\]\)]\s*/i;
          const isExplicitlyNotInFiles = notInFilesRegex.test(sentenceText);
          const cleanSentenceText = sentenceText.replace(notInFilesRegex, "").trim();

          if (!cleanSentenceText) return;

          const contentElement = renderInlineMarkdown(cleanSentenceText, `txt-${lineIdx}-${i}-${sIdx}`);

          if (cited) {
            const isHovered = hoveredIndex === nextCitationIndex;
            elements.push(
              <span
                key={`span-${lineIdx}-${i}-${sIdx}`}
                className={`rounded px-0.5 border-b cursor-pointer transition-all duration-200 ${
                  isHovered
                    ? "bg-accent-teal/20 dark:bg-accent-teal/25 border-accent-teal text-slate-900 dark:text-white"
                    : "bg-accent-teal/5 dark:bg-accent-teal/10 border-dashed border-accent-teal/30 hover:bg-accent-teal/15 dark:hover:bg-accent-teal/20"
                }`}
                onMouseEnter={() => setHoveredIndex(nextCitationIndex)}
                onMouseLeave={() => setHoveredIndex(null)}
                title={`Cited from Source [${nextCitationIndex}]`}
              >
                {contentElement}
              </span>
            );
          } else if (isExplicitlyNotInFiles) {
            elements.push(
              <span
                key={`span-not-in-files-${lineIdx}-${i}-${sIdx}`}
                className="rounded px-0.5 border-b border-dashed border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10 text-rose-600 dark:text-rose-350 cursor-help transition-all duration-200 hover:bg-rose-500/15"
                title="This statement is not found in the uploaded files (outside knowledge or general clinical knowledge)."
              >
                {contentElement}
              </span>
            );
          } else {
            elements.push(
              <React.Fragment key={`frag-${lineIdx}-${i}-${sIdx}`}>
                {contentElement}{" "}
              </React.Fragment>
            );
          }
        });
      }
    }

    return elements;
  }

  // 3. Render content line by line, recognizing lists and paragraphs
  const lines = reconstructedAnswer.split("\n");
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
        </ul>
      );
    } else if (currentListType === "ordered") {
      renderedElements.push(
        <ol key={`ol-${currentListKey}`} className="list-decimal ml-5 pl-1 my-2 space-y-1">
          {currentListItems}
        </ol>
      );
    }
    currentListItems = [];
    currentListType = null;
    currentListKey++;
  }

  lines.forEach((line, lineIdx) => {
    // Regex matches
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
            </h1>
          );
          break;
        case 2:
          renderedElements.push(
            <h2 key={`h2-${lineIdx}`} className="text-lg font-bold text-slate-900 dark:text-white mt-3.5 mb-1.5 first:mt-0 leading-snug">
              {headerContent}
            </h2>
          );
          break;
        case 3:
        default:
          renderedElements.push(
            <h3 key={`h3-${lineIdx}`} className="text-base font-semibold text-slate-900 dark:text-white mt-3 mb-1.5 first:mt-0 leading-snug">
              {headerContent}
            </h3>
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
        </li>
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
        </li>
      );
    } else {
      flushList();
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        renderedElements.push(
          <p key={`p-${lineIdx}`} className="my-2 text-foreground leading-relaxed">
            {renderLineWithCitations(line, lineIdx)}
          </p>
        );
      } else {
        // Render spacer for empty lines
        renderedElements.push(<div key={`spacer-${lineIdx}`} className="h-2" />);
      }
    }
  });

  // Flush any remaining list at the end
  flushList();

  const hasNotInFilesMarker = /\s*[\[\(](not in files|not in file|outside knowledge|ungrounded)[\]\)]\s*/i.test(answer);

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
