'use client';
import {
  Column,
  Grid,
  Heading,
  ListItem,
  Row,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from '@umami/react-zen';
import { colord } from 'colord';
import { useCallback, useMemo, useState } from 'react';
import { BarChart } from '@/components/charts/BarChart';
import { GridRow } from '@/components/common/GridRow';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { Panel } from '@/components/common/Panel';
import { useLocale, useMessages, useResultQuery } from '@/components/hooks';
import { ListTable } from '@/components/metrics/ListTable';
import { MetricLabel } from '@/components/metrics/MetricLabel';
import { PerformanceCard } from '@/components/metrics/PerformanceCard';
import { renderDateLabels } from '@/lib/charts';
import { CHART_COLORS } from '@/lib/constants';
import { generateTimeSeries } from '@/lib/date';
import { formatLongNumber } from '@/lib/format';
import styles from './Performance.module.css';

export interface PerformanceProps {
  websiteId: string;
  startDate: Date;
  endDate: Date;
  unit: string;
}

const METRICS = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const;

const METRIC_LABELS: Record<string, string> = {
  lcp: 'Largest Contentful Paint',
  inp: 'Interaction to Next Paint',
  cls: 'Cumulative Layout Shift',
  fcp: 'First Contentful Paint',
  ttfb: 'Time to First Byte',
};

function formatMetricValue(metric: string, value: number): string {
  if (metric === 'cls') return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

const PERCENTILES = [
  { id: 'p50', label: 'p50 — Median' },
  { id: 'p75', label: 'p75 — 75th Percentile' },
  { id: 'p95', label: 'p95 — 95th Percentile' },
] as const;

export function Performance({ websiteId, startDate, endDate, unit }: PerformanceProps) {
  const [selectedMetric, setSelectedMetric] = useState<string>('lcp');
  const [method, setMethod] = useState<'corrected' | 'legacy' | undefined>();
  const [selectedPercentile, setSelectedPercentile] = useState<'p50' | 'p75' | 'p95'>('p75');
  const { t, labels } = useMessages();
  const { locale, dateLocale } = useLocale();

  const { data, error, isLoading } = useResultQuery<any>('performance', {
    websiteId,
    startDate,
    endDate,
    metric: selectedMetric,
    method,
  });

  const scoped = Boolean(data?.availableMethods);

  const chartData: any = useMemo(() => {
    if (!data?.chart) return { datasets: [] };

    const p50Color = colord(CHART_COLORS[0]);
    const p75Color = colord(CHART_COLORS[1]);
    const p95Color = colord(CHART_COLORS[2]);

    const result = {
      datasets: [
        {
          label: 'p50',
          data: generateTimeSeries(
            data.chart.map((d: any) => ({
              x: d.t,
              y: scoped && d.p50 == null ? Number.NaN : Number(d.p50),
            })),
            startDate,
            endDate,
            unit,
            dateLocale,
          ),
          type: 'line',
          spanGaps: false,
          borderColor: p50Color.alpha(0.8).toRgbString(),
          backgroundColor: p50Color.alpha(0.1).toRgbString(),
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'p75',
          data: generateTimeSeries(
            data.chart.map((d: any) => ({
              x: d.t,
              y: scoped && d.p75 == null ? Number.NaN : Number(d.p75),
            })),
            startDate,
            endDate,
            unit,
            dateLocale,
          ),
          type: 'line',
          spanGaps: false,
          borderColor: p75Color.alpha(0.8).toRgbString(),
          backgroundColor: p75Color.alpha(0.1).toRgbString(),
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'p95',
          data: generateTimeSeries(
            data.chart.map((d: any) => ({
              x: d.t,
              y: scoped && d.p95 == null ? Number.NaN : Number(d.p95),
            })),
            startDate,
            endDate,
            unit,
            dateLocale,
          ),
          type: 'line',
          spanGaps: false,
          borderColor: p95Color.alpha(0.8).toRgbString(),
          backgroundColor: p95Color.alpha(0.1).toRgbString(),
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    };
    if (scoped) {
      for (const dataset of result.datasets) {
        dataset.data = dataset.data.map(point => ({
          ...point,
          y: Number.isNaN(point.y) ? null : point.y,
        }));
      }
    }
    return result;
  }, [data, startDate, endDate, unit, dateLocale, scoped]);

  const renderXLabel = useCallback(renderDateLabels(unit, locale), [unit, locale]);

  const isCls = selectedMetric === 'cls';
  const metricLabel = t(labels[selectedMetric]) || selectedMetric.toUpperCase();
  const formatListCount = isCls
    ? (n: number) => n.toFixed(3)
    : (n: number) => `${(n / 1000).toFixed(2)} s`;

  return (
    <Column gap>
      <Grid columns="280px" gap>
        <Select
          label="Percentile"
          value={selectedPercentile}
          onChange={value => setSelectedPercentile(value as 'p50' | 'p75' | 'p95')}
        >
          {PERCENTILES.map(({ id, label }) => (
            <ListItem key={id} id={id}>
              {label}
            </ListItem>
          ))}
        </Select>
        {scoped && (
          <Select
            label="Measurement method"
            value={method || data.method || 'corrected'}
            onChange={value => setMethod(value as 'corrected' | 'legacy')}
          >
            <ListItem id="corrected">Corrected</ListItem>
            <ListItem id="legacy">Legacy</ListItem>
          </Select>
        )}
      </Grid>
      {scoped && (
        <Text size="sm">
          {data.method === 'legacy'
            ? 'Legacy collection omitted many zero-shift visits and stopped updating early. These values are not directly comparable with corrected measurements.'
            : 'Corrected measurements cover full document visits, including later updates; ordinary in-app navigation does not reset them.'}
          {data.methodologyStartedAt
            ? ` Corrected collection began ${new Date(data.methodologyStartedAt).toISOString().slice(0, 10)} (UTC).`
            : ' Corrected measurements have not arrived yet.'}
        </Text>
      )}
      <LoadingPanel data={data} isLoading={isLoading} error={error}>
        {data && (
          <Column gap>
            <Grid columns={{ base: '1fr 1fr', lg: 'repeat(5, 1fr)' }} gap>
              {METRICS.map(metric => (
                <PerformanceCard
                  key={metric}
                  metric={metric}
                  value={
                    scoped && data.summary?.[metric]?.[selectedPercentile] == null
                      ? null
                      : Number(data.summary?.[metric]?.[selectedPercentile] || 0)
                  }
                  sampleCount={scoped ? Number(data.summary?.[metric]?.count || 0) : undefined}
                  label={t(labels[metric]) || metric.toUpperCase()}
                  formatValue={(n: number) => formatMetricValue(metric, n)}
                  onClick={() => setSelectedMetric(metric)}
                  selected={selectedMetric === metric}
                />
              ))}
            </Grid>
            <Panel>
              <Column gap="4" padding="4">
                <Row justifyContent="space-between" alignItems="center">
                  <Text weight="bold">{METRIC_LABELS[selectedMetric]}</Text>
                  <Row gap="4">
                    <Text size="sm" className={styles.sampleCount}>
                      {t(labels.sampleSize)}:{' '}
                      {formatLongNumber(
                        scoped
                          ? data.summary?.[selectedMetric]?.count || 0
                          : data.summary?.count || 0,
                      )}
                    </Text>
                  </Row>
                </Row>
                <BarChart
                  chartData={chartData}
                  minDate={startDate}
                  maxDate={endDate}
                  unit={unit}
                  renderXLabel={renderXLabel}
                  renderYLabel={(label: string) => {
                    const val = Number(label);
                    if (selectedMetric === 'cls') return val.toFixed(2);
                    if (val >= 1000) return `${(val / 1000).toFixed(2)} s`;
                    return `${Math.round(val)} ms`;
                  }}
                  height="400px"
                />
              </Column>
            </Panel>
            <GridRow layout="two">
              <Panel>
                <Tabs>
                  <Heading size="2xl">{t(labels.pages)}</Heading>
                  <TabList>
                    <Tab id="path">{t(labels.path)}</Tab>
                    <Tab id="title">{t(labels.pageTitle)}</Tab>
                  </TabList>
                  <TabPanel id="path">
                    <ListTable
                      metric={metricLabel}
                      showPercentage={false}
                      formatCount={formatListCount}
                      data={data.pages
                        ?.filter(({ p50, p75, p95, count }: any) =>
                          scoped
                            ? Number(count) > 0 && { p50, p75, p95 }[selectedPercentile] != null
                            : Number({ p50, p75, p95 }[selectedPercentile]) > 0,
                        )
                        .slice(0, 20)
                        .map(({ name, p50, p75, p95, count }: any) => ({
                          label: name,
                          count: Number({ p50, p75, p95 }[selectedPercentile]),
                          percent: 0,
                          sampleCount: scoped ? Number(count) : undefined,
                        }))}
                      renderLabel={(row: any) => (
                        <Text>
                          {row.label}
                          {scoped ? ` (n=${row.sampleCount})` : ''}
                        </Text>
                      )}
                    />
                  </TabPanel>
                  <TabPanel id="title">
                    <ListTable
                      metric={metricLabel}
                      showPercentage={false}
                      formatCount={formatListCount}
                      data={data.pageTitles
                        ?.filter(({ p50, p75, p95, count }: any) =>
                          scoped
                            ? Number(count) > 0 && { p50, p75, p95 }[selectedPercentile] != null
                            : Number({ p50, p75, p95 }[selectedPercentile]) > 0,
                        )
                        .slice(0, 20)
                        .map(({ name, p50, p75, p95, count }: any) => ({
                          label: name,
                          count: Number({ p50, p75, p95 }[selectedPercentile]),
                          percent: 0,
                          sampleCount: scoped ? Number(count) : undefined,
                        }))}
                      renderLabel={(row: any) => (
                        <Row gap="2">
                          <MetricLabel type="title" data={row} />
                          {scoped && <Text size="sm">n={row.sampleCount}</Text>}
                        </Row>
                      )}
                    />
                  </TabPanel>
                </Tabs>
              </Panel>
              <Panel>
                <Tabs>
                  <Heading size="2xl">{t(labels.environment)}</Heading>
                  <TabList>
                    <Tab id="device">{t(labels.device)}</Tab>
                    <Tab id="browser">{t(labels.browser)}</Tab>
                  </TabList>
                  <TabPanel id="device">
                    <ListTable
                      metric={metricLabel}
                      showPercentage={false}
                      formatCount={formatListCount}
                      data={data.devices
                        ?.filter(({ p50, p75, p95, count }: any) =>
                          scoped
                            ? Number(count) > 0 && { p50, p75, p95 }[selectedPercentile] != null
                            : Number({ p50, p75, p95 }[selectedPercentile]) > 0,
                        )
                        .slice(0, 20)
                        .map(({ name, p50, p75, p95, count }: any) => ({
                          label: name,
                          count: Number({ p50, p75, p95 }[selectedPercentile]),
                          percent: 0,
                          sampleCount: scoped ? Number(count) : undefined,
                        }))}
                      renderLabel={(row: any) => (
                        <Row gap="2">
                          <MetricLabel type="device" data={row} />
                          {scoped && <Text size="sm">n={row.sampleCount}</Text>}
                        </Row>
                      )}
                    />
                  </TabPanel>
                  <TabPanel id="browser">
                    <ListTable
                      metric={metricLabel}
                      showPercentage={false}
                      formatCount={formatListCount}
                      data={data.browsers
                        ?.filter(({ p50, p75, p95, count }: any) =>
                          scoped
                            ? Number(count) > 0 && { p50, p75, p95 }[selectedPercentile] != null
                            : Number({ p50, p75, p95 }[selectedPercentile]) > 0,
                        )
                        .slice(0, 20)
                        .map(({ name, p50, p75, p95, count }: any) => ({
                          label: name,
                          count: Number({ p50, p75, p95 }[selectedPercentile]),
                          percent: 0,
                          sampleCount: scoped ? Number(count) : undefined,
                        }))}
                      renderLabel={(row: any) => (
                        <Row gap="2">
                          <MetricLabel type="browser" data={row} />
                          {scoped && <Text size="sm">n={row.sampleCount}</Text>}
                        </Row>
                      )}
                    />
                  </TabPanel>
                </Tabs>
              </Panel>
            </GridRow>
          </Column>
        )}
      </LoadingPanel>
    </Column>
  );
}
