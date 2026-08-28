/**
 * The composer's footer row.
 *
 * Desktop lays it out as attachments and toggles on the left, model controls
 * and send on the right. Mobile keeps everything on one line and swaps the
 * model controls for the compact buttons above the text, because the footer
 * has to stay reachable with one thumb.
 *
 * The dictation component is rendered here on desktop only: on mobile it lives
 * at the composer wrapper level so a recording started from the collapsed pill
 * survives the expand.
 */

import React from 'react';

import { SessionGoalButton, SessionGoalObjectiveCounter } from '@/components/chat/SessionGoalButton';
import { ComposerDictation } from '@/components/dictation/ComposerDictation';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ModelControls } from '../../ModelControls';
import { ComposerActionButtons } from './ComposerActionButtons';
import { ComposerAttachmentControls } from './ComposerAttachmentControls';
import { FocusModeButton } from './FocusModeButton';
import { PermissionAutoAcceptButton } from './PermissionAutoAcceptButton';
import type { SessionMetrics } from '../../sessionMetrics';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const MemoModelControls = React.memo(ModelControls);
const MemoComposerDictation = React.memo(ComposerDictation);

export interface ComposerFooterProps {
    isMobile: boolean;
    isVSCode: boolean;
    sessionId: string | null;
    directory?: string;
    newSessionDraftOpen: boolean;
    messageLength: number;
    sessionMetrics?: SessionMetrics;

    radius: string;
    footerPaddingClass: string;
    footerGapClass: string;
    footerIconButtonClass: string;
    iconSizeClass: string;
    sendIconSizeClass: string;
    stopIconSizeClass: string;

    canSend: boolean;
    canAbort: boolean;
    hasContent: boolean;
    isExpandedInput: boolean;
    permissionAutoAcceptEnabled: boolean;
    isPermissionAutoAcceptInteractive: boolean;
    dictationActive: boolean;

    onOpenSettings?: () => void;
    onPickLocalFiles: () => void;
    onOpenIssuePicker: () => void;
    onOpenPrPicker: () => void;
    onOpenAttachSheet: () => void;
    onToggleExpandedInput: () => void;
    onTogglePermissionAutoAccept: () => void;
    onPrimaryAction: () => void;
    onQueueMessage: () => void;
    onAbort: () => void;
    onStartDictation: () => void;
    onDictationInsert: (text: string) => void;
    onDictationInsertAndSend: (text: string) => void;
    onDictationContentHeightChange: (height: number | null) => void;
}

export function ComposerFooter(props: ComposerFooterProps) {
    const { t } = useI18n();
    const {
        isMobile,
        isVSCode,
        sessionId: currentSessionId,
        directory,
        newSessionDraftOpen,
        messageLength,
        sessionMetrics,
        radius: chatInputRadius,
        footerPaddingClass,
        footerGapClass,
        footerIconButtonClass,
        iconSizeClass,
        sendIconSizeClass,
        stopIconSizeClass,
        canSend,
        canAbort,
        hasContent,
        isExpandedInput,
        permissionAutoAcceptEnabled,
        isPermissionAutoAcceptInteractive,
        dictationActive,
        onOpenSettings,
        onPickLocalFiles,
        onOpenIssuePicker,
        onOpenPrPicker,
        onOpenAttachSheet,
        onToggleExpandedInput,
        onTogglePermissionAutoAccept,
        onPrimaryAction,
        onQueueMessage,
        onAbort,
        onStartDictation,
        onDictationInsert,
        onDictationInsertAndSend,
        onDictationContentHeightChange,
    } = props;

    const formatCount = (value: number): string => value.toLocaleString();
    const formatDuration = (value: number): string => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
    const metricItems = sessionMetrics ? [
        sessionMetrics.model,
        sessionMetrics.turns > 0 ? `${t('chat.sessionMetrics.turns')}: ${formatCount(sessionMetrics.turns)}` : null,
        sessionMetrics.steps > 0 ? `${t('chat.sessionMetrics.steps')}: ${formatCount(sessionMetrics.steps)}` : null,
        sessionMetrics.tokens?.total !== undefined ? `${t('chat.sessionMetrics.tokens')}: ${formatCount(sessionMetrics.tokens.total)}` : null,
        sessionMetrics.tokens ? `${t('contextSidebar.tokens.input')}: ${formatCount(sessionMetrics.tokens.input)}` : null,
        sessionMetrics.tokens ? `${t('contextSidebar.tokens.output')}: ${formatCount(sessionMetrics.tokens.output)}` : null,
        sessionMetrics.tokens ? `${t('contextSidebar.tokens.reasoning')}: ${formatCount(sessionMetrics.tokens.reasoning)}` : null,
        sessionMetrics.tokens ? `${t('chat.sessionMetrics.cacheTokens')}: ${formatCount(sessionMetrics.tokens.cacheRead + sessionMetrics.tokens.cacheWrite)}` : null,
        sessionMetrics.llmDurationMs !== undefined ? `${t('chat.sessionMetrics.llm')}: ${formatDuration(sessionMetrics.llmDurationMs)}` : null,
        sessionMetrics.toolDurationMs !== undefined ? `${t('chat.sessionMetrics.tools')}: ${formatDuration(sessionMetrics.toolDurationMs)}` : null,
        sessionMetrics.ttftMs !== undefined ? `${t('chat.sessionMetrics.ttft')}: ${formatDuration(sessionMetrics.ttftMs)}` : null,
        sessionMetrics.cacheHitPercent !== undefined ? `${t('chat.sessionMetrics.cache')}: ${sessionMetrics.cacheHitPercent.toFixed(1)}%` : null,
        sessionMetrics.outputTokensPerSecond !== undefined ? `${sessionMetrics.outputTokensPerSecond.toFixed(1)} ${t('chat.sessionMetrics.speed')}` : null,
    ].filter((item): item is string => Boolean(item)) : [];

    return (
        <div
            className={cn(
                'bg-transparent flex w-full flex-shrink-0 flex-col',
                footerPaddingClass,
                footerGapClass,
            )}
            style={{
                borderBottomLeftRadius: chatInputRadius,
                borderBottomRightRadius: chatInputRadius,
            }}
            data-chat-input-footer="true"
        >
            {metricItems.length > 0 ? (
                <div className="mb-1 flex w-full min-w-0 flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-1 typography-micro text-muted-foreground/70" data-session-metrics="true">
                    {metricItems.map((item, index) => (
                        <Tooltip key={`${item}-${index}`}>
                            <TooltipTrigger asChild>
                                <span className="truncate tabular-nums">{item}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[min(80vw,32rem)] break-words">
                                {item}
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            ) : null}
            <div className={cn('flex w-full items-center', isMobile ? 'gap-x-1.5' : cn('justify-between', footerGapClass))}>
            {isMobile ? (
                <>
                    <div className="flex w-full items-center justify-between gap-x-1.5">
                        <div className="composer-mobile-actions flex items-center gap-x-2 pl-1">
                            <ComposerAttachmentControls
                                isVSCode={isVSCode}
                                footerIconButtonClass={footerIconButtonClass}
                                iconSizeClass={iconSizeClass}
                                handlePickLocalFiles={onPickLocalFiles}
                                openIssuePicker={onOpenIssuePicker}
                                openPrPicker={onOpenPrPicker}
                                onOpenSettings={onOpenSettings}
                                onOpenMobileSheet={onOpenAttachSheet}
                            />
                            <PermissionAutoAcceptButton
                                footerIconButtonClass={footerIconButtonClass}
                                iconSizeClass={iconSizeClass}
                                isInteractive={isPermissionAutoAcceptInteractive}
                                permissionAutoAcceptEnabled={permissionAutoAcceptEnabled}
                                handlePermissionAutoAcceptToggle={onTogglePermissionAutoAccept}
                            />
                            <SessionGoalButton
                                sessionId={currentSessionId}
                                directory={directory}
                                draftOpen={newSessionDraftOpen}
                                footerIconButtonClass={footerIconButtonClass}
                                iconSizeClass={iconSizeClass}
                            />
                            <SessionGoalObjectiveCounter length={messageLength} />
                        </div>
                        <div className="flex items-center min-w-0 gap-x-1 justify-end">
                            <div className="flex items-center gap-x-1 flex-shrink-0">
                                <button
                                    type="button"
                                    className={footerIconButtonClass}
                                    // Keep the soft keyboard open (same guard as
                                    // PermissionAutoAcceptButton); the recording
                                    // engine lives in the wrapper-level
                                    // ComposerDictation instance.
                                    onMouseDown={(event) => event.preventDefault()}
                                    onPointerDownCapture={(event) => {
                                        if (event.pointerType === 'touch') {
                                            event.preventDefault();
                                        }
                                    }}
                                    onClick={onStartDictation}
                                    disabled={dictationActive}
                                    title={t('chat.dictation.start')}
                                    aria-label={t('chat.dictation.start')}
                                >
                                    <Icon name="mic" className={cn(iconSizeClass, 'text-current')} />
                                </button>
                                <ComposerActionButtons
                                    isMobile={isMobile}
                                    footerIconButtonClass={footerIconButtonClass}
                                    sendIconSizeClass={sendIconSizeClass}
                                    stopIconSizeClass={stopIconSizeClass}
                                    canSend={canSend}
                                    canAbort={canAbort}
                                    hasContent={hasContent}
                                    currentSessionId={currentSessionId}
                                    newSessionDraftOpen={newSessionDraftOpen}
                                    onPrimaryAction={onPrimaryAction}
                                    onQueueMessage={onQueueMessage}
                                    onAbort={onAbort}
                                />
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <div className={cn("flex items-center flex-shrink-0", footerGapClass)}>
                        <ComposerAttachmentControls
                            isVSCode={isVSCode}
                            footerIconButtonClass={footerIconButtonClass}
                            iconSizeClass={iconSizeClass}
                            handlePickLocalFiles={onPickLocalFiles}
                            openIssuePicker={onOpenIssuePicker}
                            openPrPicker={onOpenPrPicker}
                            onOpenSettings={onOpenSettings}
                        />
                        <FocusModeButton
                            footerIconButtonClass={footerIconButtonClass}
                            iconSizeClass={iconSizeClass}
                            isExpandedInput={isExpandedInput}
                            onToggle={onToggleExpandedInput}
                        />
                        <PermissionAutoAcceptButton
                            footerIconButtonClass={footerIconButtonClass}
                            iconSizeClass={iconSizeClass}
                            isInteractive={isPermissionAutoAcceptInteractive}
                            permissionAutoAcceptEnabled={permissionAutoAcceptEnabled}
                            handlePermissionAutoAcceptToggle={onTogglePermissionAutoAccept}
                            withTooltip
                        />
                        <SessionGoalButton
                            sessionId={currentSessionId}
                            directory={directory}
                            draftOpen={newSessionDraftOpen}
                            footerIconButtonClass={footerIconButtonClass}
                            iconSizeClass={iconSizeClass}
                            withTooltip
                        />
                        <SessionGoalObjectiveCounter length={messageLength} />
                    </div>
                    <div className={cn('flex items-center flex-1 justify-end', footerGapClass, 'md:gap-x-3')}>
                        <MemoModelControls className={cn('flex-1 min-w-0 justify-end')} />
                        <MemoComposerDictation
                            radius={chatInputRadius}
                            isMobile={isMobile}
                            footerIconButtonClass={footerIconButtonClass}
                            footerPaddingClass={footerPaddingClass}
                            iconSizeClass={iconSizeClass}
                            sendIconSizeClass={sendIconSizeClass}
                            onInsert={onDictationInsert}
                            onInsertAndSend={onDictationInsertAndSend}
                            onContentHeightChange={onDictationContentHeightChange}
                        />
                        <ComposerActionButtons
                            isMobile={isMobile}
                            footerIconButtonClass={footerIconButtonClass}
                            sendIconSizeClass={sendIconSizeClass}
                            stopIconSizeClass={stopIconSizeClass}
                            canSend={canSend}
                            canAbort={canAbort}
                            hasContent={hasContent}
                            currentSessionId={currentSessionId}
                            newSessionDraftOpen={newSessionDraftOpen}
                            onPrimaryAction={onPrimaryAction}
                            onQueueMessage={onQueueMessage}
                            onAbort={onAbort}
                        />
                    </div>
                </>
            )}
            </div>
        </div>
    );
}
