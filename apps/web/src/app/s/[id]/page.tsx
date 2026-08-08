import { notFound } from 'next/navigation';
import { RoomGate } from '../../../components/room-gate';
import { isValidSessionId } from '../../../lib/session';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isValidSessionId(id)) {
    notFound();
  }

  return <RoomGate sessionId={id} />;
}
