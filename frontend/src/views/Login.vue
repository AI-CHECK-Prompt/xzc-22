<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-hero">
        <div>
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
            <div class="brand-logo">CRL</div>
            <div style="color:#9bd4ff; letter-spacing:4px; font-size:12px;">CHEM REGULATORY LAB</div>
          </div>
          <h1>高校化学品<br/>全生命周期监管平台</h1>
          <p>覆盖采购、暂存、领用、双人核验、使用登记、废液归集、空瓶回收、统计与审计追溯的统一数字底座。</p>
        </div>
        <ul>
          <li>唯一追溯码：兼容二维码与 RFID</li>
          <li>高危品类上限与强制限量</li>
          <li>移动端离线缓存 + 自动重试同步</li>
          <li>审计追溯：追溯码主键全链路</li>
        </ul>
      </div>
      <div class="login-form">
        <h2>登录到平台</h2>
        <p class="sub">请使用校内统一账号登录</p>
        <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
          <el-form-item label="账号">
            <el-input v-model="form.username" placeholder="请输入账号" size="large" :prefix-icon="User" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" :prefix-icon="Lock" show-password />
          </el-form-item>
          <el-button type="primary" size="large" :loading="loading" @click="onSubmit">登 录</el-button>
          <div class="login-tips">
            默认管理员：<code>admin / admin123</code>　其他角色账号同密码
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { User, Lock } from "@element-plus/icons-vue";
import { http } from "../utils/http";
import { useUserStore } from "../stores/user";

const form = reactive({ username: "admin", password: "admin123" });
const loading = ref(false);
const router = useRouter();
const userStore = useUserStore();

async function onSubmit() {
  loading.value = true;
  try {
    const res: any = await http.post("/auth/login", form);
    userStore.setSession(res.data.token, res.data.user);
    ElMessage.success("登录成功");
    router.push("/dashboard");
  } catch (e) {
    /* http 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.brand-logo {
  width: 42px; height: 42px; border-radius: 12px;
  background: linear-gradient(135deg, #3a7bd5, #00d2ff);
  display: grid; place-items: center; font-weight: 800; color: #fff;
}
</style>
