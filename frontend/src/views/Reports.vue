<template>
  <div class="page">
    <div class="kpi-grid">
      <div class="kpi"><div class="label">采购计划</div><div class="value">{{ stats.plans }}</div></div>
      <div class="kpi warn"><div class="label">领用申请</div><div class="value">{{ stats.requisitions }}</div></div>
      <div class="kpi"><div class="label">试剂瓶</div><div class="value">{{ stats.bottles }}</div></div>
      <div class="kpi danger"><div class="label">废液桶</div><div class="value">{{ stats.buckets }}</div></div>
    </div>
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>采购金额（按月）</h3>
        <v-chart :option="amountOpt" autoresize style="height:280px;" />
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>领用频次</h3>
        <v-chart :option="freqOpt" autoresize style="height:280px;" />
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>库存周转率</h3>
        <v-chart :option="turnOpt" autoresize style="height:280px;" />
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>废液分类</h3>
        <v-chart :option="wasteOpt" autoresize style="height:280px;" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { TooltipComponent, GridComponent, LegendComponent } from "echarts/components";
import VChart from "vue-echarts";
import { http } from "../utils/http";

use([CanvasRenderer, BarChart, LineChart, PieChart, TooltipComponent, GridComponent, LegendComponent]);

const amount = ref<any[]>([]);
const freq = ref<any[]>([]);
const turn = ref<any[]>([]);
const waste = ref<any>({ byHandoff: {}, byBucket: [] });
const stats = ref<any>({});

onMounted(async () => {
  const [a, f, t, w, d] = await Promise.all([
    http.get("/reports/procurement-amount"),
    http.get("/reports/usage-frequency"),
    http.get("/reports/inventory-turnover"),
    http.get("/reports/waste-stat"),
    http.get("/reports/dashboard"),
  ]);
  amount.value = (a as any).data;
  freq.value = (f as any).data;
  turn.value = (t as any).data;
  waste.value = (w as any).data;
  stats.value = (d as any).data;
});

const amountOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { top: 16, left: 32, right: 16, bottom: 24 },
  xAxis: { type: "category", data: amount.value.map((x) => x.month), axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" } },
  yAxis: { type: "value", axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" } },
  series: [{ type: "line", smooth: true, data: amount.value.map((x) => x.amount), itemStyle: { color: "#00d2ff" }, areaStyle: { color: "rgba(0,210,255,0.2)" } }],
}));

const freqOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { top: 16, left: 8, right: 16, bottom: 48 },
  xAxis: { type: "category", data: freq.value.map((x) => x.name), axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4", rotate: 30 } },
  yAxis: { type: "value", axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" } },
  series: [{ type: "bar", data: freq.value.map((x) => x.count), itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#00d2ff" }, { offset: 1, color: "#3a7bd5" }] }, borderRadius: [4, 4, 0, 0] } }],
}));

const turnOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { top: 16, left: 8, right: 16, bottom: 48 },
  xAxis: { type: "category", data: turn.value.map((x) => x.name), axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4", rotate: 30 } },
  yAxis: { type: "value", min: 0, max: 1, axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" } },
  series: [{ type: "bar", data: turn.value.map((x) => x.turnover), itemStyle: { color: "#6ed6a3", borderRadius: [4, 4, 0, 0] } }],
}));

const wasteOpt = computed(() => {
  const cats = ["ORGANIC", "HEAVY_METAL", "ACID", "ALKALI", "OXIDIZER"];
  const labelMap: any = { ORGANIC: "有机", HEAVY_METAL: "重金属", ACID: "酸性", ALKALI: "碱性", OXIDIZER: "氧化" };
  const byH = waste.value.byHandoff || {};
  return {
    tooltip: { trigger: "item" },
    legend: { textStyle: { color: "#b6c2d4" }, bottom: 0 },
    series: [{
      type: "pie", radius: ["40%", "70%"],
      data: cats.map((c) => ({ name: labelMap[c], value: byH[c] || 0 })),
      label: { color: "#b6c2d4" },
    }],
  };
});
</script>
