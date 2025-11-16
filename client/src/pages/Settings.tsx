import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Breadcrumb, generateSettingsBreadcrumbs } from "@/components/Breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Settings as SettingsIcon, 
  Database, 
  Brain, 
  Search, 
  Filter, 
  Zap,
  AlertCircle,
  CheckCircle,
  Info,
  ExternalLink,
  Cpu,
  Globe,
  Clock,
  Shield,
  Target,
  TrendingUp,
  Users,
  BarChart3,
  Layers,
  Workflow,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Star
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ApiStatus {
  name: string;
  status: 'operational' | 'degraded' | 'outage';
  lastChecked: string;
  error?: string;
  responseTime?: number;
}

interface SystemHealth {
  overall: 'operational' | 'degraded' | 'outage';
  apis: ApiStatus[];
  lastUpdate: string;
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedDeletions, setSelectedDeletions] = useState<string[]>([]);
  const { toast } = useToast();

  // Fetch real-time system health
  const { data: healthData, refetch: refetchHealth } = useQuery<SystemHealth>({
    queryKey: ['/api/health/status'],
    refetchInterval: false, // Disable automatic refresh - only manual refresh
  });

  // Fetch analysis statistics
  const { data: statsData } = useQuery<{
    totalDays: number;
    analyzedDays: number;
    completionPercentage: number;
  }>({
    queryKey: ['/api/analysis/stats'],
  });

  // Define deletion options
  const deletionOptions = [
    { id: 'analyses', label: 'Historical Bitcoin news analyses', endpoint: '/api/database/clear-analyses' },
    { id: 'manual-entries', label: 'Manual news entries and user data', endpoint: '/api/database/clear-manual-entries' },
    { id: 'source-credibility', label: 'Source credibility settings', endpoint: '/api/database/clear-source-credibility' },
    { id: 'spam-domains', label: 'Spam filters and blocked domains', endpoint: '/api/database/clear-spam-domains' },
    { id: 'ai-prompts', label: 'AI prompts and system configurations', endpoint: '/api/database/clear-ai-prompts' },
    { id: 'users', label: 'User authentication data', endpoint: '/api/database/clear-users' },
  ];

  // Selective deletion mutation
  const selectiveDeletionMutation = useMutation({
    mutationFn: async (deletionIds: string[]) => {
      const selectedOptions = deletionOptions.filter(option => deletionIds.includes(option.id));
      const results = [];
      
      for (const option of selectedOptions) {
        const response = await fetch(option.endpoint, {
          method: 'DELETE',
        });
        if (!response.ok) {
          throw new Error(`Failed to clear ${option.label}`);
        }
        const result = await response.json();
        results.push({ option: option.label, result });
      }
      
      return results;
    },
    onSuccess: (results) => {
      const deletedItems = results.map(r => r.option).join(', ');
      toast({
        title: "Data Cleared Successfully",
        description: `The following data has been deleted: ${deletedItems}`,
      });
      setConfirmDelete(false);
      setSelectedDeletions([]);
      // Invalidate all queries to refresh the UI
      queryClient.invalidateQueries();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to clear selected data: ${error.message}`,
        variant: "destructive",
      });
      setConfirmDelete(false);
    },
  });

  // Database deletion mutation (keep for backwards compatibility)
  const deleteAllDataMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/database/clear-all', {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to clear database');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Database Cleared",
        description: "All data has been successfully deleted from the database.",
      });
      setConfirmDelete(false);
      setSelectedDeletions([]);
      // Invalidate all queries to refresh the UI
      queryClient.invalidateQueries();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to clear database: ${error.message}`,
        variant: "destructive",
      });
      setConfirmDelete(false);
    },
  });

  const StatusIndicator = ({ status }: { status: 'operational' | 'degraded' | 'outage' }) => {
    const config = {
      operational: { icon: CheckCircle, color: "text-green-500", bg: "bg-green-100" },
      degraded: { icon: AlertCircle, color: "text-yellow-500", bg: "bg-yellow-100" },
      outage: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-100" }
    };
    const { icon: Icon, color, bg } = config[status];
    
    return (
      <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full ${bg}`}>
        <Icon className={`w-4 h-4 ${color}`} />
        <span className={`text-xs font-medium ${color}`}>{status}</span>
      </div>
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Breadcrumb Navigation */}
      <Breadcrumb 
        items={generateSettingsBreadcrumbs()} 
        className="text-sm"
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <SettingsIcon className="w-6 h-6" />
          <h1 className="text-2xl font-bold">System Settings & Architecture</h1>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={() => refetchHealth()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Status
          </Button>
          <StatusIndicator status={healthData?.overall || 'outage'} />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Architecture</TabsTrigger>
          <TabsTrigger value="ai">AI Providers</TabsTrigger>
          <TabsTrigger value="services">API Services</TabsTrigger>
          <TabsTrigger value="pipeline">Data Pipeline</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* System Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Cpu className="w-5 h-5" />
                <span>Bitcoin News Analysis System</span>
              </CardTitle>
              <CardDescription>
                Advanced Bitcoin news analysis platform with hierarchical search, period-aware filtering, and AI-powered summarization covering Bitcoin's complete history (2008-2030)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Core Components */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 border rounded-lg bg-blue-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Search className="w-5 h-5 text-blue-600" />
                    <h3 className="font-semibold text-blue-900">Hierarchical Search</h3>
                  </div>
                  <p className="text-sm text-blue-700">3-tier search strategy: Bitcoin → Crypto/Web3 → Macroeconomics with intelligent fallbacks</p>
                </div>
                
                <div className="p-4 border rounded-lg bg-green-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Filter className="w-5 h-5 text-green-600" />
                    <h3 className="font-semibold text-green-900">Period-Aware Filtering</h3>
                  </div>
                  <p className="text-sm text-green-700">6 historical periods with specialized filtering algorithms and date accuracy validation</p>
                </div>
                
                <div className="p-4 border rounded-lg bg-purple-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Brain className="w-5 h-5 text-purple-600" />
                    <h3 className="font-semibold text-purple-900">AI Analysis</h3>
                  </div>
                  <p className="text-sm text-purple-700">GPT-4o mini with period-specific prompting, 100-110 character summaries, no date references</p>
                </div>
                
                <div className="p-4 border rounded-lg bg-orange-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Zap className="w-5 h-5 text-orange-600" />
                    <h3 className="font-semibold text-orange-900">Streaming Batch Processing</h3>
                  </div>
                  <p className="text-sm text-orange-700">3x concurrent requests with server-side streaming for ultra-fast monthly analysis</p>
                </div>
                
                <div className="p-4 border rounded-lg bg-red-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Shield className="w-5 h-5 text-red-600" />
                    <h3 className="font-semibold text-red-900">Historical Accuracy</h3>
                  </div>
                  <p className="text-sm text-red-700">Strict date filtering, tier 1 outlet prioritization, duplicate prevention, anniversary detection</p>
                </div>
                
                <div className="p-4 border rounded-lg bg-indigo-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Database className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-semibold text-indigo-900">PostgreSQL + Caching</h3>
                  </div>
                  <p className="text-sm text-indigo-700">Drizzle ORM with in-memory caching layer and comprehensive schema for historical data</p>
                </div>
              </div>

              <Separator />

              {/* Historical Periods */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center space-x-2">
                  <Clock className="w-4 h-4" />
                  <span>Bitcoin Historical Periods (2008-2030)</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="p-3 border rounded-lg bg-red-50">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <span className="font-medium text-sm">Global Financial Crisis</span>
                    </div>
                    <p className="text-xs text-gray-600">2008-2009</p>
                    <p className="text-xs text-gray-500 mt-1">Pre-Bitcoin macroeconomic context, financial crisis coverage</p>
                  </div>
                  
                  <div className="p-3 border rounded-lg bg-orange-50">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-orange-500" />
                      <span className="font-medium text-sm">Eurozone Debt Crisis</span>
                    </div>
                    <p className="text-xs text-gray-600">2010-2012</p>
                    <p className="text-xs text-gray-500 mt-1">Early Bitcoin period, first exchanges, Pizza Day</p>
                  </div>
                  
                  <div className="p-3 border rounded-lg bg-yellow-50">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <span className="font-medium text-sm">Early Altcoin Era</span>
                    </div>
                    <p className="text-xs text-gray-600">2013-2016</p>
                    <p className="text-xs text-gray-500 mt-1">First major bubble, Mt. Gox, altcoin emergence</p>
                  </div>
                  
                  <div className="p-3 border rounded-lg bg-green-50">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <span className="font-medium text-sm">ICO Boom</span>
                    </div>
                    <p className="text-xs text-gray-600">2017-2018</p>
                    <p className="text-xs text-gray-500 mt-1">Mainstream adoption, ICO mania, second major bubble</p>
                  </div>
                  
                  <div className="p-3 border rounded-lg bg-blue-50">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-blue-500" />
                      <span className="font-medium text-sm">DeFi/NFT Wave</span>
                    </div>
                    <p className="text-xs text-gray-600">2020-2021</p>
                    <p className="text-xs text-gray-500 mt-1">Institutional adoption, DeFi explosion, NFT boom</p>
                  </div>
                  
                  <div className="p-3 border rounded-lg bg-purple-50">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-purple-500" />
                      <span className="font-medium text-sm">Contemporary Era</span>
                    </div>
                    <p className="text-xs text-gray-600">2022-2030</p>
                    <p className="text-xs text-gray-500 mt-1">ETF approval, regulatory clarity, mainstream integration</p>
                  </div>
                </div>
              </div>

              {/* System Statistics */}
              {statsData && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center space-x-2">
                    <BarChart3 className="w-4 h-4" />
                    <span>Analysis Coverage</span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">{statsData?.totalDays?.toLocaleString() || '0'}</div>
                      <div className="text-sm text-gray-600">Total Days Since 2008</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">{statsData?.analyzedDays?.toLocaleString() || '0'}</div>
                      <div className="text-sm text-gray-600">Days Analyzed</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">{Math.round(statsData?.completionPercentage || 0)}%</div>
                      <div className="text-sm text-gray-600">Coverage</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-orange-600">{((statsData?.totalDays || 0) - (statsData?.analyzedDays || 0)).toLocaleString()}</div>
                      <div className="text-sm text-gray-600">Remaining Days</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          {/* AI Providers Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Brain className="w-5 h-5" />
                <span>Dual AI Analysis System</span>
              </CardTitle>
              <CardDescription>
                Advanced multi-provider AI analysis using both OpenAI and Anthropic for comprehensive Bitcoin news insights
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* OpenAI Card */}
                <div className="p-6 border rounded-lg bg-gradient-to-br from-green-50 to-emerald-50">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                      <Brain className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-green-900">OpenAI GPT-4o</h3>
                      <p className="text-sm text-green-700">Primary Analysis Engine</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm">
                      <div className="font-medium text-green-900 mb-1">Capabilities</div>
                      <ul className="text-green-700 space-y-1">
                        <li>• Structured data analysis</li>
                        <li>• Sentiment scoring</li>
                        <li>• Topic categorization</li>
                        <li>• Duplicate detection</li>
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-green-100 text-green-800">Fast Processing</Badge>
                      <Badge className="bg-green-100 text-green-800">JSON Output</Badge>
                      <Badge className="bg-green-100 text-green-800">Cost Effective</Badge>
                    </div>
                  </div>
                </div>

                {/* Claude Card */}
                <div className="p-6 border rounded-lg bg-gradient-to-br from-purple-50 to-violet-50">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center">
                      <Brain className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-purple-900">Claude Sonnet 4.0</h3>
                      <p className="text-sm text-purple-700">Nuanced Analysis Engine</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm">
                      <div className="font-medium text-purple-900 mb-1">Capabilities</div>
                      <ul className="text-purple-700 space-y-1">
                        <li>• Deep contextual understanding</li>
                        <li>• Significance assessment</li>
                        <li>• Key insight extraction</li>
                        <li>• Historical reasoning</li>
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-purple-100 text-purple-800">Advanced Reasoning</Badge>
                      <Badge className="bg-purple-100 text-purple-800">Context Aware</Badge>
                      <Badge className="bg-purple-100 text-purple-800">Nuanced</Badge>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Analysis Mode */}
              <div>
                <h3 className="font-semibold mb-4">AI Analysis Provider</h3>
                <div className="grid grid-cols-1 md:grid-cols-1 gap-4 max-w-md">
                  <div className="p-4 border rounded-lg text-center">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Brain className="w-6 h-6 text-green-600" />
                    </div>
                    <h4 className="font-medium text-green-900 mb-2">OpenAI GPT-4o</h4>
                    <p className="text-sm text-gray-600 mb-3">Fast, structured analysis with proven reliability for Bitcoin news</p>
                    <Badge variant="outline">Active Provider</Badge>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Technical Implementation */}
              <div>
                <h3 className="font-semibold mb-4">AI Analysis Implementation</h3>
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg bg-gray-50">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">1</div>
                      <div className="flex-1">
                        <h4 className="font-medium text-blue-900">Structured Prompting</h4>
                        <p className="text-sm text-gray-600 mt-1">
                          Period-aware prompts with historical context for accurate Bitcoin news analysis
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 border rounded-lg bg-gray-50">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold text-sm">2</div>
                      <div className="flex-1">
                        <h4 className="font-medium text-purple-900">Content Processing</h4>
                        <p className="text-sm text-gray-600 mt-1">
                          Full article analysis with sentiment detection and confidence scoring
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 border rounded-lg bg-gray-50">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm">3</div>
                      <div className="flex-1">
                        <h4 className="font-medium text-green-900">Quality Assurance</h4>
                        <p className="text-sm text-gray-600 mt-1">
                          Automatic validation with fallback to historical Bitcoin events database
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-6">
          {/* API Services Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Globe className="w-5 h-5" />
                <span>External API Services</span>
              </CardTitle>
              <CardDescription>
                Real-time status monitoring of external APIs powering the Bitcoin news analysis system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {healthData?.apis.map((api) => (
                <div key={api.name} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      {api.name === 'OpenAI' && <Brain className="w-6 h-6 text-purple-600" />}

                      {api.name === 'EXA' && <Search className="w-6 h-6 text-blue-600" />}
                    </div>
                    <div>
                      <h3 className="font-semibold">{api.name}</h3>
                      <p className="text-sm text-gray-600">
                        {api.name === 'OpenAI' && 'GPT-4o mini for AI analysis and summarization'}

                        {api.name === 'EXA' && 'Primary news source with neural search capabilities'}
                      </p>
                      {api.responseTime && (
                        <p className="text-xs text-gray-500">Response time: {api.responseTime}ms</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end space-y-2">
                    <StatusIndicator status={api.status} />
                    <span className="text-xs text-gray-500">
                      Last checked: {new Date(api.lastChecked).toLocaleTimeString()}
                    </span>
                    {api.error && (
                      <span className="text-xs text-red-500 max-w-xs truncate">{api.error}</span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>


        </TabsContent>

        <TabsContent value="pipeline" className="space-y-6">
          {/* Data Pipeline Flow */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Workflow className="w-5 h-5" />
                <span>Analysis Pipeline</span>
              </CardTitle>
              <CardDescription>
                Comprehensive data flow from news discovery to AI analysis and storage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Step 1: Hierarchical Search */}
                <div className="flex items-start space-x-4 p-4 border rounded-lg bg-blue-50">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">1</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-blue-900">Hierarchical News Search</h3>
                    <p className="text-sm text-blue-700 mt-1">
                      3-tier strategy: Bitcoin Events → Crypto & Web3 → Macroeconomics. Each tier uses period-specific queries with intelligent fallbacks.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">EXA Primary</Badge>
                      <Badge variant="outline" className="text-xs">Date Range ±1 day</Badge>
                    </div>
                  </div>
                </div>

                {/* Step 2: Multi-Source Integration */}
                <div className="flex items-start space-x-4 p-4 border rounded-lg bg-green-50">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm">2</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-green-900">Multi-Source Article Aggregation</h3>
                    <p className="text-sm text-green-700 mt-1">
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">Duplicate Detection</Badge>
                      <Badge variant="outline" className="text-xs">Source Credibility</Badge>
                      <Badge variant="outline" className="text-xs">Content Quality</Badge>
                    </div>
                  </div>
                </div>

                {/* Step 3: Enhanced Filtering */}
                <div className="flex items-start space-x-4 p-4 border rounded-lg bg-yellow-50">
                  <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center text-white font-bold text-sm">3</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-yellow-900">Period-Aware Filtering</h3>
                    <p className="text-sm text-yellow-700 mt-1">
                      Strict date filtering with tier 1 outlet prioritization. Validates historical accuracy and prevents cross-contamination.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">Tier 1 Priority</Badge>
                      <Badge variant="outline" className="text-xs">Exact Date Match</Badge>
                      <Badge variant="outline" className="text-xs">Anniversary Detection</Badge>
                    </div>
                  </div>
                </div>

                {/* Step 4: AI Analysis */}
                <div className="flex items-start space-x-4 p-4 border rounded-lg bg-purple-50">
                  <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold text-sm">4</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-purple-900">Dual AI Analysis & Summarization</h3>
                    <p className="text-sm text-purple-700 mt-1">
                      Multi-provider AI analysis with OpenAI GPT-4o and Anthropic Claude Sonnet 4.0 for nuanced, comprehensive insights.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">GPT-4o</Badge>
                      <Badge variant="outline" className="text-xs">Claude Sonnet 4.0</Badge>
                      <Badge variant="outline" className="text-xs">Dual AI Synthesis</Badge>
                      <Badge variant="outline" className="text-xs">100-110 chars</Badge>
                    </div>
                  </div>
                </div>

                {/* Step 5: Database Storage */}
                <div className="flex items-start space-x-4 p-4 border rounded-lg bg-indigo-50">
                  <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-sm">5</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-indigo-900">PostgreSQL Storage & Caching</h3>
                    <p className="text-sm text-indigo-700 mt-1">
                      Stores analysis results with comprehensive metadata, source tracking, and in-memory caching for fast retrieval.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">Drizzle ORM</Badge>
                      <Badge variant="outline" className="text-xs">Source Tracking</Badge>
                      <Badge variant="outline" className="text-xs">TTL Caching</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Search Strategy Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Target className="w-5 h-5" />
                <span>Search Strategy Configuration</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold text-blue-900 mb-2">Tier 1: Bitcoin Events</h3>
                  <p className="text-sm text-gray-600 mb-3">Direct Bitcoin-related news and historical events</p>
                  <div className="space-y-1 text-xs">
                    <div>• Bitcoin historical events database</div>
                    <div>• Verified milestones (Genesis, Pizza Day, Halvings)</div>
                    <div>• Protocol upgrades and forks</div>
                    <div>• Corporate adoption announcements</div>
                  </div>
                </div>
                
                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold text-green-900 mb-2">Tier 2: Crypto & Web3</h3>
                  <p className="text-sm text-gray-600 mb-3">Broader cryptocurrency and blockchain ecosystem</p>
                  <div className="space-y-1 text-xs">
                    <div>• Cryptocurrency market movements</div>
                    <div>• Blockchain technology developments</div>
                    <div>• Regulatory announcements</div>
                    <div>• Exchange and platform news</div>
                  </div>
                </div>
                
                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold text-orange-900 mb-2">Tier 3: Macroeconomics</h3>
                  <p className="text-sm text-gray-600 mb-3">Financial context and economic environment</p>
                  <div className="space-y-1 text-xs">
                    <div>• Financial crisis coverage</div>
                    <div>• Central bank policies</div>
                    <div>• Economic indicators</div>
                    <div>• Market volatility events</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {/* Performance Optimizations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="w-5 h-5" />
                <span>Performance Optimizations</span>
              </CardTitle>
              <CardDescription>
                Advanced performance features and optimizations implemented in the system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-green-900">Speed Improvements</h3>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3 p-3 bg-green-50 rounded">
                      <Zap className="w-5 h-5 text-green-600" />
                      <div>
                        <div className="font-medium text-sm">Streaming Batch Processing</div>
                        <div className="text-xs text-gray-600">3x concurrent requests with real-time progress</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded">
                      <Layers className="w-5 h-5 text-blue-600" />
                      <div>
                        <div className="font-medium text-sm">In-Memory Caching</div>
                        <div className="text-xs text-gray-600">TTL-based caching for API responses</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-purple-50 rounded">
                      <Database className="w-5 h-5 text-purple-600" />
                      <div>
                        <div className="font-medium text-sm">Smart Cache Invalidation</div>
                        <div className="text-xs text-gray-600">Optimistic updates and selective refresh</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-orange-900">API Rate Limiting</h3>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3 p-3 bg-orange-50 rounded">
                      <Clock className="w-5 h-5 text-orange-600" />
                      <div>
                        <div className="font-medium text-sm">Batch Delays</div>
                        <div className="text-xs text-gray-600">1-second delays between batches</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-red-50 rounded">
                      <Shield className="w-5 h-5 text-red-600" />
                      <div>
                        <div className="font-medium text-sm">Concurrency Control</div>
                        <div className="text-xs text-gray-600">Maximum 3 simultaneous requests</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-indigo-50 rounded">
                      <RefreshCw className="w-5 h-5 text-indigo-600" />
                      <div>
                        <div className="font-medium text-sm">Graceful Fallbacks</div>
                        <div className="text-xs text-gray-600">Automatic retry with exponential backoff</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Batch Processing Statistics */}
              <div>
                <h3 className="font-semibold mb-3">Bulk Analysis Performance</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-xl font-bold text-blue-600">3x</div>
                    <div className="text-sm text-gray-600">Speed Improvement</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-xl font-bold text-green-600">3</div>
                    <div className="text-sm text-gray-600">Concurrent Requests</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-xl font-bold text-orange-600">1s</div>
                    <div className="text-sm text-gray-600">Batch Delay</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-xl font-bold text-purple-600">Real-time</div>
                    <div className="text-sm text-gray-600">Progress Updates</div>
                  </div>
                </div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  The system automatically detects already analyzed dates and skips them during bulk processing, further improving efficiency.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Error Handling */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="w-5 h-5" />
                <span>Error Handling & Reliability</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-2">Runtime Error Prevention</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Enhanced JSON parsing validation</li>
                    <li>• Null-safe property access throughout</li>
                    <li>• Route parameter validation</li>
                    <li>• Graceful fallback mechanisms</li>
                  </ul>
                </div>
                
                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-2">API Resilience</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Automatic fallback between providers</li>
                    <li>• Health monitoring with alerts</li>
                    <li>• Retry logic with exponential backoff</li>
                    <li>• Comprehensive error logging</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="database" className="space-y-6">
          {/* Database Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Database className="w-5 h-5" />
                <span>Database Management</span>
              </CardTitle>
              <CardDescription>
                Manage and maintain the Bitcoin news analysis database
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Database Statistics */}
              {statsData && (
                <div>
                  <h3 className="font-semibold mb-3">Current Database State</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg bg-blue-50">
                      <div className="text-2xl font-bold text-blue-600">{statsData?.analyzedDays?.toLocaleString() || '0'}</div>
                      <div className="text-sm text-gray-600">Historical Analyses</div>
                      <div className="text-xs text-gray-500 mt-1">Days with AI-generated summaries</div>
                    </div>
                    <div className="p-4 border rounded-lg bg-green-50">
                      <div className="text-2xl font-bold text-green-600">{Math.round(statsData?.completionPercentage || 0)}%</div>
                      <div className="text-sm text-gray-600">Coverage Complete</div>
                      <div className="text-xs text-gray-500 mt-1">Of Bitcoin's history since 2008</div>
                    </div>
                    <div className="p-4 border rounded-lg bg-purple-50">
                      <div className="text-2xl font-bold text-purple-600">{((statsData?.totalDays || 0) - (statsData?.analyzedDays || 0)).toLocaleString()}</div>
                      <div className="text-sm text-gray-600">Days Remaining</div>
                      <div className="text-xs text-gray-500 mt-1">Still to be analyzed</div>
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* Database Tables */}
              <div>
                <h3 className="font-semibold mb-3">Database Schema</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Core Tables</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>historical_news_analyses</span>
                        <Badge variant="outline">Primary</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>manual_news_entries</span>
                        <Badge variant="outline">User Data</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>users</span>
                        <Badge variant="outline">Auth</Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Configuration Tables</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>source_credibility</span>
                        <Badge variant="outline">Config</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>spam_domains</span>
                        <Badge variant="outline">Filter</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>ai_prompts</span>
                        <Badge variant="outline">System</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Danger Zone */}
              <div className="border border-red-200 rounded-lg p-6 bg-red-50">
                <div className="flex items-center space-x-2 mb-4">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <h3 className="font-semibold text-red-900">Danger Zone</h3>
                </div>
                
                <Alert className="mb-4 border-red-200 bg-red-50">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    <strong>Warning:</strong> Select which data to permanently delete from the database.
                    These actions cannot be undone.
                  </AlertDescription>
                </Alert>

                {!confirmDelete ? (
                  <div className="space-y-4">
                    {/* Data Selection */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-red-900">Select data to delete:</h4>
                      {deletionOptions.map((option) => (
                        <div key={option.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={option.id}
                            checked={selectedDeletions.includes(option.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedDeletions(prev => [...prev, option.id]);
                              } else {
                                setSelectedDeletions(prev => prev.filter(id => id !== option.id));
                              }
                            }}
                          />
                          <label
                            htmlFor={option.id}
                            className="text-sm text-red-800 cursor-pointer"
                          >
                            {option.label}
                          </label>
                        </div>
                      ))}
                    </div>

                    {/* Quick Actions */}
                    <div className="flex space-x-2 text-xs">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedDeletions(deletionOptions.map(o => o.id))}
                        className="text-red-600 border-red-300 hover:bg-red-50"
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedDeletions([])}
                        className="text-red-600 border-red-300 hover:bg-red-50"
                      >
                        Clear Selection
                      </Button>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-3">
                      <Button 
                        variant="destructive" 
                        onClick={() => setConfirmDelete(true)}
                        disabled={selectedDeletions.length === 0}
                        className="flex-1"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Selected Data ({selectedDeletions.length})
                      </Button>
                      
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setSelectedDeletions(deletionOptions.map(o => o.id));
                          setConfirmDelete(true);
                        }}
                        className="flex-1 text-red-600 border-red-300 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Everything
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-red-800 font-medium">
                      Are you absolutely sure? This will permanently delete the following:
                    </div>
                    
                    <div className="bg-red-100 border border-red-300 rounded p-3">
                      <ul className="text-xs text-red-700 space-y-1">
                        {selectedDeletions.map(id => {
                          const option = deletionOptions.find(o => o.id === id);
                          return option ? <li key={id}>• {option.label}</li> : null;
                        })}
                      </ul>
                    </div>
                    
                    <div className="flex space-x-3">
                      <Button 
                        variant="destructive" 
                        onClick={() => {
                          if (selectedDeletions.length === deletionOptions.length) {
                            deleteAllDataMutation.mutate();
                          } else {
                            selectiveDeletionMutation.mutate(selectedDeletions);
                          }
                        }}
                        disabled={selectiveDeletionMutation.isPending || deleteAllDataMutation.isPending}
                        className="flex-1"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {(selectiveDeletionMutation.isPending || deleteAllDataMutation.isPending) 
                          ? 'Deleting...' 
                          : `Yes, Delete ${selectedDeletions.length === deletionOptions.length ? 'Everything' : 'Selected'}`
                        }
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => setConfirmDelete(false)}
                        disabled={selectiveDeletionMutation.isPending || deleteAllDataMutation.isPending}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}