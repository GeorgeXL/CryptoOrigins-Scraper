import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, FileText, XCircle } from 'lucide-react';

interface VeriBadgeProps {
  badge: 'Manual' | 'Orphan' | 'Verified' | 'Not Available' | null | undefined;
  className?: string;
}

export function VeriBadge({ badge, className }: VeriBadgeProps) {
  if (!badge) {
    return null;
  }

  const badgeConfig = {
    'Manual': {
      icon: FileText,
      className: 'bg-blue-100 text-blue-800 border-blue-300',
      label: 'Manual'
    },
    'Orphan': {
      icon: AlertCircle,
      className: 'bg-orange-100 text-orange-800 border-orange-300',
      label: 'Orphan'
    },
    'Verified': {
      icon: CheckCircle,
      className: 'bg-green-100 text-green-800 border-green-300',
      label: 'Verified'
    },
    'Not Available': {
      icon: XCircle,
      className: 'bg-gray-100 text-gray-800 border-gray-300',
      label: 'Not Available'
    }
  };

  const config = badgeConfig[badge];
  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={`${config.className} text-xs px-1.5 py-0.5 inline-flex items-center space-x-1 w-fit ${className || ''}`}
      title={`Verification Status: ${config.label}`}
    >
      <Icon className="w-2.5 h-2.5" />
      <span>{config.label}</span>
    </Badge>
  );
}

