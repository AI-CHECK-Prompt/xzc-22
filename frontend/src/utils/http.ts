import axios from "axios";
import { ElMessage } from "element-plus";
import router from "../router";

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api/v1",
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  const t = localStorage.getItem("token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

http.interceptors.response.use(
  (r) => {
    const body = r.data;
    if (body && typeof body === "object" && "code" in body) {
      if (body.code === 0) return body;
      ElMessage.error(body.message || "请求失败");
      return Promise.reject(body);
    }
    return body;
  },
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("token");
      router.push("/login");
    }
    ElMessage.error(err?.response?.data?.message || err.message);
    return Promise.reject(err);
  },
);
