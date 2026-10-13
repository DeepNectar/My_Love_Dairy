import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { FIXED_USER_ID, verifyHardcodedPassword } from "../lib/hardcodedAuth";
import { createLocalSession } from "../lib/localSession";
function Auth({ onAuthSuccess }) {
  const userId = FIXED_USER_ID;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (userId !== FIXED_USER_ID) {
      setError("Invalid user ID.");
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 150));
      if (!verifyHardcodedPassword(password)) {
        setError("Incorrect password. Please try again.");
        setLoading(false);
        return;
      }
      await createLocalSession();
      await onAuthSuccess();
    } catch (err) {
      setError(err?.message || "Login failed");
      setLoading(false);
    }
  };
  return /* @__PURE__ */ jsx("div", { className: "min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center p-4", children: /* @__PURE__ */ jsxs("div", { className: "bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden", children: [
    /* @__PURE__ */ jsxs("div", { className: "bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-6 text-center", children: [
      /* @__PURE__ */ jsx("div", { className: "text-5xl mb-3", children: "\u{1F4D6}" }),
      /* @__PURE__ */ jsx("h1", { className: "text-2xl font-bold text-white font-serif", children: "My Diary" }),
      /* @__PURE__ */ jsx("p", { className: "text-amber-100 text-sm mt-1", children: "Your private cloud journal" })
    ] }),
    /* @__PURE__ */ jsxs("form", { onSubmit: handleLogin, className: "p-8 space-y-5", children: [
      /* @__PURE__ */ jsxs("div", { className: "text-center mb-6", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold text-amber-900", children: "Welcome Back" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-amber-700 mt-1", children: "Log in to access your diary" })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("label", { className: "block text-sm font-medium text-amber-800 mb-1.5", children: "User ID" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: userId,
            readOnly: true,
            disabled: true,
            "aria-readonly": "true",
            className: "w-full px-4 py-2.5 border border-amber-200 rounded-xl outline-none bg-amber-100/70 text-amber-900 font-medium cursor-not-allowed select-none"
          }
        ),
        /* @__PURE__ */ jsx("p", { className: "text-xs text-amber-500 mt-1", children: "\u{1F512} Fixed account \u2014 cannot be changed" })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("label", { className: "block text-sm font-medium text-amber-800 mb-1.5", children: "Password" }),
        /* @__PURE__ */ jsxs("div", { className: "relative", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: showPassword ? "text" : "password",
              value: password,
              onChange: (e) => setPassword(e.target.value),
              placeholder: "Enter your password...",
              autoFocus: true,
              autoComplete: "off",
              className: "w-full px-4 py-2.5 pr-11 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50",
              required: true
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => setShowPassword((s) => !s),
              className: "absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 hover:text-amber-700 text-lg",
              title: showPassword ? "Hide password" : "Show password",
              children: showPassword ? "\u{1F648}" : "\u{1F441}\uFE0F"
            }
          )
        ] })
      ] }),
      error && /* @__PURE__ */ jsxs("div", { className: "bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm", children: [
        "\u274C ",
        error
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "submit",
          disabled: loading || !password,
          className: "w-full bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed",
          children: loading ? "\u23F3 Please wait..." : "\u{1F513} Log In"
        }
      )
    ] })
  ] }) });
}
export {
  Auth as default
};
