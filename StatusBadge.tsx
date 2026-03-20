import React from 'react';
import styles from './StatusBadge.module.css';

export type StatusVariant = 'success' | 'warning' | 'error';

interface StatusBadgeProps {
  /** The status variant of the badge */
  status: StatusVariant;
  /** Optional label to display inside the badge. Defaults to capitalized status. */
  label?: string;
  /** Optional additional CSS class names */
  className?: string;
}

/**
 * StatusBadge component provides a visual indicator for different states.
 * Follows accessibility guidelines with appropriate contrast and semantic markers.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ 
  status, 
  label, 
  className = '' 
}) => {
  const displayLabel = label || status.charAt(0).toUpperCase() + status.slice(1);
  
  return (
    <span 
      className={`${styles.badge} ${styles[status]} ${className}`}
      role="status"
      aria-label={`${status} status: ${displayLabel}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{displayLabel}</span>
    </span>
  );
};

export default StatusBadge;
