import React from 'react';

/**
 * RecallProbe Component
 * Token: glacier-74
 */

export interface RecallProbeProps {
  /** Optional label for the probe button */
  label?: string;
  /** Optional click handler */
  onClick?: () => void;
}

const RecallProbe: React.FC<RecallProbeProps> = ({ 
  label = 'Verify Token', 
  onClick 
}) => {
  return (
    <div className="recall-probe-container" data-token="glacier-74">
      <button 
        type="button"
        className="recall-probe-trigger"
        onClick={onClick}
        aria-label={`${label} - glacier-74`}
      >
        <span className="recall-probe-icon" aria-hidden="true" />
        <span className="recall-probe-text">{label}</span>
      </button>
      <style>{`
        .recall-probe-container {
          display: inline-block;
          padding: 4px;
        }

        .recall-probe-trigger {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 12px 24px;
          background-color: var(--color-surface, #ffffff);
          color: var(--color-text, #1a1a1a);
          border: 2px solid var(--color-border, #e0e0e0);
          border-radius: 8px;
          font-family: inherit;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }

        .recall-probe-trigger:hover {
          border-color: var(--color-primary, #0070f3);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 112, 243, 0.1);
        }

        .recall-probe-trigger:active {
          transform: translateY(0);
        }

        .recall-probe-trigger:focus-visible {
          outline: 3px solid rgba(0, 112, 243, 0.4);
          outline-offset: 2px;
        }

        .recall-probe-icon {
          width: 12px;
          height: 12px;
          background-color: #00cf7f;
          border-radius: 50%;
          position: relative;
        }

        .recall-probe-icon::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          border: 2px solid #00cf7f;
          animation: probe-pulse 2s infinite;
        }

        @keyframes probe-pulse {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(2.5); opacity: 0; }
        }

        .recall-probe-text {
          line-height: 1.2;
        }

        @media (max-width: 640px) {
          .recall-probe-trigger {
            width: 100%;
            justify-content: center;
            padding: 16px;
          }
        }
      `}</style>
    </div>
  );
};

export default RecallProbe;
