import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useStore } from '../store';
import Sidebar from './Sidebar';
import MessageList from './MessageList';
import MessageViewer from './MessageViewer';
import ComposeModal from './ComposeModal';
import SearchResults from './SearchResults';

export default function MainLayout() {
  const { activeMailbox, setActiveMailbox, composeOpen, isSearching } = useStore();

  const { data: mailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => api.getMailboxes(),
  });

  // Auto-select first mailbox
  useEffect(() => {
    if (mailboxes && mailboxes.length > 0 && !activeMailbox) {
      setActiveMailbox(mailboxes[0]);
    }
  }, [mailboxes, activeMailbox, setActiveMailbox]);

  return (
    <div className="h-full flex bg-[#f5f5f7]">
      {/* Sidebar */}
      <Sidebar mailboxes={mailboxes ?? []} />

      {/* Content area */}
      <div className="flex flex-1 min-w-0 gap-0 p-3 pl-0">
        {/* Message list */}
        <div className="w-80 flex-shrink-0 flex flex-col mr-3">
          {isSearching ? <SearchResults /> : <MessageList />}
        </div>

        {/* Message viewer */}
        <div className="flex-1 min-w-0">
          <MessageViewer />
        </div>
      </div>

      {/* Compose modal */}
      {composeOpen && <ComposeModal />}
    </div>
  );
}
