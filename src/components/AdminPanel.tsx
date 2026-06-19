"use client";

import React, { useState, useEffect } from "react";
import { SafeUser } from "@/lib/auth";

interface AdminPanelProps {
  onClose: () => void;
  onBalanceUpdated?: () => void;
  currentUserId?: string;
}

const getExplorerLink = (method: string | undefined, txHash: string | undefined): string => {
  if (!txHash) return "";
  const cleanTx = txHash.trim();
  switch (method) {
    case "EVM":
      return `https://etherscan.io/tx/${cleanTx}`;
    case "TON":
      return `https://tonviewer.com/transaction/${cleanTx}`;
    case "TRON":
      return `https://tronscan.org/#/transaction/${cleanTx}`;
    case "BTC":
      return `https://mempool.space/tx/${cleanTx}`;
    default:
      return "";
  }
};

interface CreditRequest {
  id: string;
  userId: string;
  email: string;
  packageId: string;
  amount: number;
  status: "pending" | "completed";
  createdAt: string;
  paymentMethod?: string;
  txHash?: string;
}

export default function AdminPanel({ onClose, onBalanceUpdated, currentUserId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<"users" | "requests">("users");
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Selection & top-up states for Users list tab
  const [selectedUser, setSelectedUser] = useState<SafeUser | null>(null);
  const [fundAmount, setFundAmount] = useState<number>(100);
  const [funding, setFunding] = useState(false);
  const [fundSuccess, setFundSuccess] = useState(false);

  // Fetch users list
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to load users.");
      }
      
      setUsers(data.users || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load users";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch pending requests list
  const fetchRequests = async () => {
    try {
      setLoadingRequests(true);
      setError(null);
      const res = await fetch("/api/admin/requests");
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to load requests.");
      }
      
      setRequests(data.requests || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load requests";
      setError(message);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchRequests();
  }, []);

  // Poll requests on tab change
  useEffect(() => {
    if (activeTab === "requests") {
      fetchRequests();
    }
  }, [activeTab]);

  // Handle direct credit update from the right side form
  const handleFundCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    
    setFunding(true);
    setError(null);
    setFundSuccess(false);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id, amount: fundAmount }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to add credits.");
      }

      // Update local users array
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUser.id ? { ...u, credits: data.user.credits } : u))
      );
      
      // Update selected user display
      setSelectedUser(data.user);
      setFundSuccess(true);

      // If updating yourself, trigger callback
      if (selectedUser.id === currentUserId && onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Credit update failed";
      setError(message);
    } finally {
      setFunding(false);
    }
  };

  // Approve a pending user request
  const handleApproveRequest = async (requestId: string, userId: string, amount: number) => {
    setError(null);
    setFundSuccess(false);

    try {
      const res = await fetch("/api/admin/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to approve request.");
      }

      // Remove request from pending list
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      
      // Update users array locally
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, credits: u.credits + amount } : u))
      );

      // If selected user details are shown, update them too
      if (selectedUser?.id === userId) {
        setSelectedUser((prev) => prev ? { ...prev, credits: prev.credits + amount } : null);
      }

      // If updating yourself, trigger callback
      if (userId === currentUserId && onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request approval failed";
      setError(message);
    }
  };

  // Filter users by search term
  const filteredUsers = users.filter((u) =>
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Compute stats
  const totalUsers = users.length;
  const totalCredits = users.reduce((acc, u) => acc + u.credits, 0);
  const pendingRequestsCount = requests.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col md:flex-row bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-2xl animate-scaleUp transition-colors duration-200">
        {/* Left Side: Users list / Requests table and tabs */}
        <div className="flex-1 p-6 flex flex-col border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800 overflow-hidden">
          
          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>🛡️</span> Developer Admin Panel
            </h2>
            <div className="flex gap-2 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
              <span className="bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded">Users: {totalUsers}</span>
              <span className="bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded">Total Credits: {totalCredits}</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2 mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
            <button
              onClick={() => setActiveTab("users")}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                activeTab === "users"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-50 dark:bg-slate-950 text-slate-655 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-150 dark:border-slate-800"
              }`}
            >
              Users List
            </button>
            <button
              onClick={() => setActiveTab("requests")}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-2 ${
                activeTab === "requests"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-50 dark:bg-slate-950 text-slate-655 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-150 dark:border-slate-800"
              }`}
            >
              Pending Requests
              {pendingRequestsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-500 text-white">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          </div>

          {/* Tab: Users List */}
          {activeTab === "users" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Search bar */}
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search users by email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 text-xs focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Users Table */}
              <div className="flex-1 overflow-y-auto pr-1">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    <div className="w-5 h-5 rounded-full border-2 border-indigo-650/20 border-t-indigo-600 animate-spin mr-2" />
                    Loading users...
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    No users found.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[9px] tracking-widest text-left">
                        <th className="py-2.5 text-left">Email</th>
                        <th className="py-2.5 text-right">Credits</th>
                        <th className="py-2.5 text-right">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-855 dark:divide-slate-800">
                      {filteredUsers.map((user) => (
                        <tr
                          key={user.id}
                          onClick={() => {
                            setSelectedUser(user);
                            setFundSuccess(false);
                          }}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors ${
                            selectedUser?.id === user.id ? "bg-indigo-50 dark:bg-indigo-950/20 text-slate-950 dark:text-slate-100 font-bold" : ""
                          }`}
                        >
                          <td className="py-3 pr-2 text-left truncate max-w-[150px]">{user.email}</td>
                          <td className="py-3 text-right tabular-nums">{user.credits}</td>
                          <td className="py-3 text-right font-mono text-[9px]">
                            {user.isAdmin ? (
                              <span className="text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/50 px-1.5 py-0.5 rounded font-bold">
                                ADMIN
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500">USER</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Tab: Pending Requests */}
          {activeTab === "requests" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1">
                {loadingRequests ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    <div className="w-5 h-5 rounded-full border-2 border-indigo-650/20 border-t-indigo-600 animate-spin mr-2" />
                    Loading credit requests...
                  </div>
                ) : requests.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    No pending credit requests at the moment.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[9px] tracking-widest">
                        <th className="py-2.5">Email</th>
                        <th className="py-2.5">Network</th>
                        <th className="py-2.5">Tx Hash (Explorer)</th>
                        <th className="py-2.5 text-right">Credits</th>
                        <th className="py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-855 dark:divide-slate-800">
                      {requests.map((req) => {
                        const link = getExplorerLink(req.paymentMethod, req.txHash);
                        return (
                          <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 pr-2 truncate max-w-[120px]" title={req.email}>
                              {req.email}
                            </td>
                            <td className="py-3 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                              {req.paymentMethod || "N/A"}
                            </td>
                            <td className="py-3 pr-2 truncate max-w-[160px]">
                              {link ? (
                                <a
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 underline font-mono text-[10px] select-all cursor-pointer"
                                  title="View on Block Explorer"
                                >
                                  {req.txHash}
                                </a>
                              ) : (
                                <span className="font-mono text-[10px] text-slate-400 dark:text-slate-550">{req.txHash || "N/A"}</span>
                              )}
                            </td>
                            <td className="py-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                              +{req.amount}
                            </td>
                            <td className="py-2 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApproveRequest(req.id, req.userId, req.amount);
                                }}
                                className="px-2.5 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg cursor-pointer transition-colors active:scale-95 shadow-md shadow-emerald-550/10"
                              >
                                Approve
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Account Funding / Control Form */}
        <div className="w-full md:w-80 p-6 flex flex-col bg-slate-50 dark:bg-slate-950 overflow-y-auto">
          {selectedUser ? (
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1 font-semibold">Fund Account</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 break-all">{selectedUser.email}</p>

                {/* Details list */}
                <div className="my-6 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-3 shadow-sm transition-colors duration-200">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Current Credits:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-bold tabular-nums">
                      {selectedUser.credits}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Admin Status:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-mono">
                      {selectedUser.isAdmin ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Registered:</span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {new Date(selectedUser.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Error in panel */}
                {error && (
                  <div className="p-3 mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300">
                    {error}
                  </div>
                )}

                {/* Success alert */}
                {fundSuccess && (
                  <div className="p-3 mb-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-xs text-emerald-700 dark:text-emerald-300">
                    Credits updated successfully!
                  </div>
                )}

                {/* Input form */}
                <form onSubmit={handleFundCredits} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Amount (Positive to Add, Negative to Deduct)
                    </label>
                    <input
                      type="number"
                      value={fundAmount}
                      onChange={(e) => setFundAmount(parseInt(e.target.value) || 0)}
                      disabled={funding}
                      className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors text-sm font-semibold text-center"
                    />
                  </div>

                  {/* Preset quick buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {[100, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setFundAmount(amount)}
                        className="py-2 text-[10px] font-bold bg-white dark:bg-slate-900 hover:bg-slate-55 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 active:scale-95 transition-all cursor-pointer rounded-lg"
                      >
                        +{amount}
                      </button>
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={funding}
                    className="w-full mt-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {funding ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Apply Balance Change"
                    )}
                  </button>
                </form>
              </div>

              {/* Close Button inside controls */}
              <button
                onClick={onClose}
                className="mt-6 py-2.5 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
              >
                Close Panel
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-between items-center text-center p-4">
              <div className="my-auto flex flex-col items-center">
                <span className="text-3xl mb-3">👈</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[180px]">
                  Select a user from the Users List tab to top up their credit balance.
                </p>
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
              >
                Close Panel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
