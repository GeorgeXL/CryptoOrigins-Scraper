import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CheckCircle, AlertCircle, FileText, XCircle, ChevronDown } from 'lucide-react';

interface VeriBadgeProps {
  badge: 'Manual' | 'Orphan' | 'Verified' | 'Not Available' | null | undefined;
  className?: string;
  onBadgeChange?: (newBadge: 'Manual' | 'Orphan' | 'Verified' | 'Not Available') => void;
  date?: string;
}

export function VeriBadge({ badge, className, onBadgeChange, date }: VeriBadgeProps) {
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
  const allBadges: Array<'Manual' | 'Orphan' | 'Verified' | 'Not Available'> = ['Manual', 'Orphan', 'Verified', 'Not Available'];

  const badgeContent = (
    <>
      <Icon className="w-2.5 h-2.5" />
      <span>{config.label}</span>
      {onBadgeChange && <ChevronDown className="w-2.5 h-2.5 ml-0.5" />}
    </>
  );

  if (!onBadgeChange) {
    return (
      <Badge
        variant="outline"
        className={`${config.className} text-xs px-1.5 py-0.5 inline-flex items-center space-x-1 w-fit ${className || ''}`}
        title={`Verification Status: ${config.label}`}
      >
        {badgeContent}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`${config.className} text-xs px-1.5 py-0.5 inline-flex items-center space-x-1 w-fit rounded-md border font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer hover:opacity-80 ${className || ''}`}
          title={`Verification Status: ${config.label} (click to change)`}
          aria-label={`Change verification status from ${config.label}`}
        >
          {badgeContent}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {allBadges.map((badgeOption) => {
          const optionConfig = badgeConfig[badgeOption];
          const OptionIcon = optionConfig.icon;
          return (
            <DropdownMenuItem
              key={badgeOption}
              onClick={() => onBadgeChange(badgeOption)}
              disabled={badgeOption === badge}
              className="flex items-center gap-2"
            >
              <OptionIcon className="w-3 h-3" />
              <span>{optionConfig.label}</span>
              {badgeOption === badge && <CheckCircle className="w-3 h-3 ml-auto" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

