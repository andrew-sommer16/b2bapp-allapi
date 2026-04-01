'use client';
import { useState, Suspense } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useGlobalFilters } from '@/lib/filterContext';
import { exportToCsv } from '@/lib/exportCsv';
import { useFetch } from '@/lib/useFetch';

const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const fmtFull = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#64748b'];

const CSV_COLUMNS = [
  { key: 'name', label: 'Brand' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'pct', label: '% of Total' },
  { key: 'units', label: 'Units Sold' },
  { key: 'orders', label: 'Orders' },
  { key: 'avgOrderValue', label: 'Avg Order Value' },
];

const SkeletonCard = () => (
  <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm animate-pulse">
    <div className="h-2.5 bg-gray-200 rounded w-1/2 mb-3" />
    <div className="h-7 bg-gray-200 rounded w-3/4 mb-2" />
  </div>
);

const SkeletonRow = () => (
  <tr className="animate-pulse">
    {['30%', '20%', '15%', '15%', '15%', '15%'].map((w, i) => (
      <td key={i} className="px-5 py-4"><div className="h-3 bg-gray-100 rounded" style={{ width: w }} /></td>
    ))}
  </tr>
);

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-900 mb-1">{d.name}</p>
      <p className="text-blue-600">{fmt(d.revenue)}</p>
      <p className="text-gray-500">{d.pct}% of total</p>
    </div>
  );
}

function BrandPieChart({ brands, loading }) {
  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-40 mb-6" />
      <div className="h-64 bg-gray-100 rounded" />
    </div>
  );
  if (!brands?.length) return null;

  const top9 = brands.slice(0, 9);
  const otherRevenue = brands.slice(9).reduce((s, b) => s + b.revenue, 0);
  const otherPct = brands.slice(9).reduce((s, b) => s + b.pct, 0);
  const chartData = otherRevenue > 0
    ? [...top9, { name: 'Other', revenue: otherRevenue, pct: Math.round(otherPct * 10) / 10 }]
    : top9;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-widest">Revenue by Brand</h2>
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-100">
        <div className="p-4 flex items-center justify-center">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="revenue"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={40}
                label={({ name, pct }) => pct > 4 ? `${pct}%` : ''}
                labelLine={false}
              >
                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-auto max-h-80">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Brand</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {chartData.map((b, i) => (
                <tr key={b.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-gray-800 font-medium truncate max-w-[140px]">{b.name}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 font-medium">{fmt(b.revenue)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-14 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(b.pct, 100)}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                      <span className="text-gray-600 text-xs w-10 text-right">{b.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BrandBarChart({ brands, loading }) {
  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-40 mb-6" />
      <div className="h-64 bg-gray-100 rounded" />
    </div>
  );
  if (!brands?.length) return null;

  const top10 = brands.slice(0, 10).map(b => ({ ...b, shortName: b.name.length > 14 ? b.name.slice(0, 14) + '…' : b.name }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-widest">Top Brands by Revenue</h2>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={top10} margin={{ top: 4, right: 16, left: 8, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="shortName" tick={{ fontSize: 11, fill: '#6b7280' }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#6b7280' }} />
            <Tooltip formatter={v => fmt(v)} labelFormatter={l => brands.find(b => b.name.startsWith(l.replace('…', '')))?.name || l} contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 12 }} />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
              {top10.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ExpandedBrandRow({ brand }) {
  const [tab, setTab] = useState('products');

  const Tab = ({ id, label, count }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-2 text-xs font-semibold rounded-t-md transition-colors ${
        tab === id
          ? 'bg-white text-blue-700 border border-b-white border-gray-200 -mb-px'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${tab === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
        {count}
      </span>
    </button>
  );

  return (
    <tr className="bg-gray-50">
      <td colSpan={7} className="px-8 pt-3 pb-5">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 mb-0">
          <Tab id="products" label="Top Products" count={brand.topProducts?.length || 0} />
          <Tab id="bought" label="Companies Bought" count={brand.companiesBought?.length || 0} />
          <Tab id="notbought" label="Companies Not Bought" count={brand.companiesNotBought?.length || 0} />
        </div>

        <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
          {/* Top Products tab */}
          {tab === 'products' && (
            brand.topProducts?.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No product data available</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-5 py-3">Product</th>
                    <th className="text-left px-5 py-3">SKU</th>
                    <th className="text-right px-5 py-3">Revenue</th>
                    <th className="text-right px-5 py-3">Units</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {brand.topProducts.map(p => (
                    <tr key={p.sku} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-800 font-medium">{p.name}</td>
                      <td className="px-5 py-3 text-gray-500 font-mono text-xs">{p.sku}</td>
                      <td className="px-5 py-3 text-right text-gray-900">{fmtFull(p.revenue)}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{p.units.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* Companies Bought tab */}
          {tab === 'bought' && (
            brand.companiesBought?.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No companies purchased this brand in the selected period</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-5 py-3">Company</th>
                    <th className="text-right px-5 py-3">Revenue</th>
                    <th className="text-right px-5 py-3">Units</th>
                    <th className="text-right px-5 py-3">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {brand.companiesBought.map(c => (
                    <tr key={c.company_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{c.company_name}</td>
                      <td className="px-5 py-3 text-right text-gray-900">{fmtFull(c.revenue)}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{c.units.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{c.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* Companies Not Bought tab */}
          {tab === 'notbought' && (
            brand.companiesNotBought?.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">All companies have purchased this brand</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-5 py-3">Company</th>
                    <th className="px-5 py-3 text-xs text-gray-400 font-normal text-left">No purchases of this brand in the selected period</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {brand.companiesNotBought.map(c => (
                    <tr key={c.company_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{c.company_name}</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-red-50 text-red-600 font-medium">
                          No purchases
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </td>
    </tr>
  );
}

function BrandTable({ brands, loading }) {
  const [sort, setSort] = useState({ key: 'revenue', dir: 'desc' });
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const handleSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const SortIcon = ({ col }) => {
    if (sort.key !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  const filtered = (brands || [])
    .filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const mul = sort.dir === 'asc' ? 1 : -1;
      return ((a[sort.key] ?? 0) > (b[sort.key] ?? 0) ? 1 : -1) * mul;
    });

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-widest">Brand Breakdown</h2>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search brands..."
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => exportToCsv('brand-performance.csv', brands || [], CSV_COLUMNS)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-900"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-5 py-3 text-left cursor-pointer hover:text-gray-700 w-8" />
              <th className="px-5 py-3 text-left cursor-pointer hover:text-gray-700" onClick={() => handleSort('name')}>
                Brand <SortIcon col="name" />
              </th>
              <th className="px-5 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => handleSort('revenue')}>
                Revenue <SortIcon col="revenue" />
              </th>
              <th className="px-5 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => handleSort('pct')}>
                % of Total <SortIcon col="pct" />
              </th>
              <th className="px-5 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => handleSort('units')}>
                Units Sold <SortIcon col="units" />
              </th>
              <th className="px-5 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => handleSort('orders')}>
                Orders <SortIcon col="orders" />
              </th>
              <th className="px-5 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => handleSort('avgOrderValue')}>
                Avg Order <SortIcon col="avgOrderValue" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400 text-sm">No brands found</td></tr>
            ) : filtered.map((brand, idx) => (
              <>
                <tr
                  key={brand.name}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === brand.name ? null : brand.name)}
                >
                  <td className="px-5 py-4 text-center text-gray-400 text-xs">
                    {expanded === brand.name ? '▼' : '▶'}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[idx % COLORS.length] }} />
                      <span className="font-medium text-gray-900">{brand.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right font-semibold text-gray-900">{fmt(brand.revenue)}</td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.min(brand.pct, 100)}%` }} />
                      </div>
                      <span className="text-gray-700 text-xs w-10 text-right">{brand.pct}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right text-gray-700">{brand.units.toLocaleString()}</td>
                  <td className="px-5 py-4 text-right text-gray-700">{brand.orders.toLocaleString()}</td>
                  <td className="px-5 py-4 text-right text-gray-700">{fmt(brand.avgOrderValue)}</td>
                </tr>

                {expanded === brand.name && (
                  <ExpandedBrandRow key={`${brand.name}-expanded`} brand={brand} />
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BrandPerformanceInner() {
  const { user } = useCurrentUser();
  const { buildFilterQS, dateFrom, dateTo, customerGroups, extraFieldFilters, companyStatus } = useGlobalFilters();

  const url = user?.store_hash
    ? `/api/reports/brand-performance?${buildFilterQS({ store_hash: user.store_hash })}`
    : null;
  const { data, loading } = useFetch(url);

  const s = data?.scorecards || {};
  const brands = data?.brands || [];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Brand Performance</h1>
        <p className="text-gray-500 mt-1">Revenue, units, and top products broken down by brand</p>
      </div>

      {/* Scorecards */}
      <div className="grid grid-cols-4 gap-4">
        {loading ? (
          [...Array(4)].map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Total Revenue</p>
              <p className="text-2xl font-bold mt-1 text-blue-600">{fmt(s.totalRevenue)}</p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Total Brands</p>
              <p className="text-2xl font-bold mt-1 text-gray-900">{(s.totalBrands || 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Units Sold</p>
              <p className="text-2xl font-bold mt-1 text-indigo-600">{(s.totalUnits || 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Top Brand</p>
              <p className="text-xl font-bold mt-1 text-gray-900 truncate">{s.topBrand || '—'}</p>
              {s.topBrandPct > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{s.topBrandPct}% of revenue</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Charts side by side */}
      <div className="grid grid-cols-2 gap-6">
        <BrandPieChart brands={brands} loading={loading} />
        <BrandBarChart brands={brands} loading={loading} />
      </div>

      {/* Full brand table */}
      <BrandTable brands={brands} loading={loading} />
    </div>
  );
}

export default function BrandPerformancePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="text-gray-400 text-sm">Loading...</div></div>}>
      <BrandPerformanceInner />
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
