<template>
  <div class="app-shell">
    <aside class="aside">
      <div class="brand">
        <div class="logo">CRL</div>
        <div>
          <h1>化学品监管平台</h1>
          <small>Chem Regulatory Lab</small>
        </div>
      </div>
      <div class="menu">
        <el-menu :default-active="route.path" :router="true">
          <el-menu-item index="/dashboard"><el-icon><DataLine /></el-icon>驾驶舱</el-menu-item>
          <el-menu-item index="/procurement"><el-icon><Tickets /></el-icon>采购计划</el-menu-item>
          <el-menu-item index="/bottles"><el-icon><Box /></el-icon>暂存台账</el-menu-item>
          <el-menu-item index="/scan"><el-icon><Camera /></el-icon>扫码核验</el-menu-item>
          <el-menu-item index="/requisitions"><el-icon><Document /></el-icon>领用审批</el-menu-item>
          <el-menu-item index="/dual-verify"><el-icon><UserFilled /></el-icon>双人核验</el-menu-item>
          <el-menu-item index="/usage"><el-icon><EditPen /></el-icon>使用登记</el-menu-item>
          <el-menu-item index="/waste"><el-icon><Delete /></el-icon>废液归集</el-menu-item>
          <el-menu-item index="/empty-bottles"><el-icon><Goblet /></el-icon>空瓶回收</el-menu-item>
          <el-menu-item index="/reports"><el-icon><TrendCharts /></el-icon>统计报表</el-menu-item>
          <el-menu-item index="/audit"><el-icon><Connection /></el-icon>审计追溯</el-menu-item>
          <el-menu-item index="/compliance"><el-icon><Promotion /></el-icon>合规对接</el-menu-item>
        </el-menu>
      </div>
      <div class="user-card" v-if="userStore.user">
        <div class="avatar">{{ (userStore.user.fullName || userStore.user.username || 'U')[0] }}</div>
        <div>
          <div class="name">{{ userStore.user.fullName }}</div>
          <div class="role">{{ roleLabel(userStore.user.role) }}</div>
        </div>
        <el-icon class="logout" title="退出登录" @click="logout"><SwitchButton /></el-icon>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="crumb">化学品监管平台 / <b>{{ route.meta.title || '页面' }}</b></div>
        <div class="right">
          <div class="status-dot"></div>
          <span>系统正常</span>
          <span class="muted" style="margin-left:12px;">{{ now }}</span>
        </div>
      </div>
      <div class="content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const now = ref("");
let timer: any;
onMounted(() => {
  const tick = () => (now.value = new Date().toLocaleString("zh-CN", { hour12: false }));
  tick();
  timer = setInterval(tick, 1000);
});
onBeforeUnmount(() => clearInterval(timer));

function logout() {
  userStore.logout();
  router.push("/login");
}

const ROLE_MAP: Record<string, string> = {
  ADMIN: "系统管理员",
  EQUIPMENT_SECRETARY: "设备秘书",
  MENTOR: "导师",
  PROJECT_LEAD: "项目负责人",
  HAZMAT_ADMIN: "危化品管理员",
  RESEARCHER: "实验人员",
  SECURITY_OFFICER: "保卫处",
  RESEARCH_DEPT: "科研处",
  DEPT_LEAD: "院系负责人",
  EXTERNAL_AUDITOR: "外部审计",
};
function roleLabel(r: string) { return ROLE_MAP[r] || r; }
</script>
