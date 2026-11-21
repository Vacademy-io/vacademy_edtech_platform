import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { SpinnerGap, ChatText, PaperPlaneTilt, User, Clock, WarningCircle, Info } from "@phosphor-icons/react";
import { usePackageSessionMessages } from '@/hooks/usePackageSessionMessages';
import { formatDistanceToNow } from 'date-fns';
import { formatLocalDateTime } from '@/helpers/formatISOTime';
import type { UserMessage } from '@/types/announcement';
import { announcementApi } from '@/services/announcementApi';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';

interface PackageSessionMessagesProps {
  packageSessionId: string;
  className?: string;
}

export const PackageSessionMessages: React.FC<PackageSessionMessagesProps> = ({
  packageSessionId,
  className = '',
}) => {
  const { t } = useTranslation('courseComponentsExtra');
  const {
    stream,
    loading,
    isEnabled,
    isLoadingSettings,
    markAsRead,
    handleMessageVisibility,
    loadMoreStreamMessages,
    fetchReplies,
    postReply,
    refresh,
  } = usePackageSessionMessages({
    packageSessionId,
    enablePolling: true,
    pollingInterval: 15000,
    autoMarkAsRead: true,
    markAsReadDelay: 1000,
  });

  const [selectedMessage, setSelectedMessage] = useState<UserMessage | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isPostingReply, setIsPostingReply] = useState(false);
  
  const observerRef = useRef<IntersectionObserver | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Intersection observer for auto mark-as-read
  useEffect(() => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const messageId = entry.target.getAttribute('data-message-id');
            if (messageId) {
              handleMessageVisibility(messageId, 'STREAM', entry.isIntersecting);
            }
          });
        },
        { threshold: 0.5, rootMargin: '50px' }
      );
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleMessageVisibility]);

  // Observe message elements
  useEffect(() => {
    stream.items.forEach((message) => {
      const element = messageRefs.current.get(message.messageId);
      if (element && observerRef.current) {
        observerRef.current.observe(element);
      }
    });
  }, [stream.items]);

  const handleMessageClick = (message: UserMessage) => {
    setSelectedMessage(message);
    setShowReplies(true);
    markAsRead(message.messageId, 'STREAM');
    // Track click interaction
    announcementApi.recordInteraction(message.messageId, 'CLICKED', { source: 'PackageSessionMessages' }).catch(() => undefined);
  };

  const handlePostReply = async () => {
    if (!selectedMessage || !replyContent.trim()) return;

    setIsPostingReply(true);
    try {
      await postReply(selectedMessage.announcementId, replyContent.trim());
      setReplyContent('');
      // Refresh replies
      await fetchReplies(selectedMessage.announcementId, { page: 0, size: 20 });
    } catch (error) {
      console.error('Failed to post reply:', error);
    } finally {
      setIsPostingReply(false);
    }
  };

  const renderMessageContent = (message: UserMessage) => {
    if (message.content.type === 'html') {
      return (
        <div 
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: message.content.content }}
        />
      );
    }
    
    return <p className="text-sm text-gray-700">{message.content.content}</p>;
  };

  const renderMessageCard = (message: UserMessage, modeType: 'STREAM' | 'COMMUNITY') => (
    <Card 
      key={message.messageId}
      className={`mb-4 cursor-pointer transition-all hover:shadow-md ${
        !message.isRead ? 'border-s-4 border-s-blue-500 bg-blue-50' : ''
      }`}
      ref={(el) => {
        if (el) {
          messageRefs.current.set(message.messageId, el);
        }
      }}
      data-message-id={message.messageId}
      data-mode-type={modeType}
      onClick={() => handleMessageClick(message)}
    >
      <CardContent className="p-card">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {message.title && (
              <h4 className="font-medium text-gray-900">{message.title}</h4>
            )}
            {message.streamType && (
              <Badge variant="outline" className="text-xs">
                {message.streamType}
              </Badge>
            )}
            {message.communityType && (
              <Badge variant="outline" className="text-xs">
                {message.communityType}
              </Badge>
            )}
            {message.tag && (
              <Badge variant="secondary" className="text-xs">
                {message.tag}
              </Badge>
            )}
            {!message.isRead && (
              <div className="w-2 h-2 bg-blue-500 rounded-full" />
            )}
          </div>
        </div>
        
        <div className="text-sm text-gray-600 mb-3">
          {renderMessageContent(message)}
        </div>
        
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            {message.createdByName && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {message.createdByName}
              </span>
            )}
            {message.createdAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatLocalDateTime(message.createdAt)}
              </span>
            )}
          </div>
          
          {message.repliesCount > 0 && (
            <span className="flex items-center gap-1">
              <ChatText className="h-3 w-3" />
              {t('packageSessionMessages.repliesCount', { count: message.repliesCount })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderRepliesSection = () => {
    if (!selectedMessage) return null;

    return typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-4xl max-h-screen-90 overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{t('packageSessionMessages.discussion')}</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowReplies(false)}
                  >
                    {t('packageSessionMessages.close')}
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent className="p-0">
                <div className="flex flex-col h-view-dialog">
                  {/* Original Message */}
                  <div className="p-4 border-b border-gray-200 bg-gray-50">
                    {renderMessageCard(selectedMessage, selectedMessage.modeType as 'STREAM' | 'COMMUNITY')}
                  </div>
                  
                  {/* Replies */}
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {/* Reply Composer */}
                      <div className="border rounded-lg p-3">
                        <Textarea
                          placeholder={t('packageSessionMessages.writeReplyPlaceholder')}
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          className="min-h-20 resize-none"
                        />
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Info className="h-3 w-3" />
                            <span>{t('packageSessionMessages.replyVisibilityNotice')}</span>
                          </div>
                          <Button
                            size="sm"
                            onClick={handlePostReply}
                            disabled={!replyContent.trim() || isPostingReply}
                          >
                            {isPostingReply ? (
                              <>
                                <SpinnerGap className="h-4 w-4 animate-spin me-2" />
                                {t('packageSessionMessages.posting')}
                              </>
                            ) : (
                              <>
                                <PaperPlaneTilt className="h-4 w-4 me-2" />
                                {t('packageSessionMessages.postReply')}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Replies List */}
                      <div className="space-y-3">
                        {/* TODO: Implement replies list */}
                        <div className="text-center py-8 text-gray-500 space-y-2">
                          <ChatText className="h-8 w-8 mx-auto text-gray-400" />
                          <p>{t('packageSessionMessages.repliesWillAppearHere')}</p>
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </div>,
          document.body
        )
      : null;
  };

  // Don't render if not enabled or still loading settings
  if (isLoadingSettings || !isEnabled) {
    return null;
  }

  return (
    <div className={className}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChatText className="h-5 w-5 text-blue-600" />
              {t('packageSessionMessages.courseDiscussion', {
                course: getTerminology(ContentTerms.Course, SystemTerms.Course),
              })}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? <SpinnerGap className="h-4 w-4 animate-spin" /> : t('common.refresh')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">

          {stream.error && (
            <div className="flex items-center gap-2 text-sm text-red-600 mb-4 p-3 bg-red-50 rounded-md">
              <WarningCircle className="h-4 w-4" />
              {stream.error}
            </div>
          )}

          {stream.loading && stream.items.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <SpinnerGap className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ms-2 text-sm text-gray-500">{t('packageSessionMessages.loadingStreamMessages')}</span>
            </div>
          ) : stream.items.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <ChatText className="h-8 w-8 text-gray-400 mx-auto" />
              <p className="text-sm text-gray-500">{t('packageSessionMessages.noStreamMessages')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stream.items.map((message) => renderMessageCard(message, 'STREAM'))}

              {stream.hasMore && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadMoreStreamMessages}
                    disabled={stream.loading}
                  >
                    {stream.loading ? (
                      <>
                        <SpinnerGap className="h-4 w-4 animate-spin me-2" />
                        {t('common.loading')}
                      </>
                    ) : (
                      t('common.loadMore')
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Replies Modal */}
      {showReplies && renderRepliesSection()}
    </div>
  );
};
