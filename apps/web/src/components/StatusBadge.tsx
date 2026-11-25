import { STATUS_LABEL, type Status } from '../types';

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={`estado estado-${status}`}>{STATUS_LABEL[status]}</span>;
}
