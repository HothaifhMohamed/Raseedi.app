import React from 'react';
import { SupportAndLegalModal } from './SupportAndLegalModal';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  return <SupportAndLegalModal isOpen={isOpen} onClose={onClose} initialTab="legal" />;
};
