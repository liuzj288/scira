'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authClient, betterauthClient } from '@/lib/auth-client';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SEARCH_LIMITS, PRICING } from '@/lib/constants';
import { LOOKOUT_LIMITS } from '@/app/lookout/constants';
import { DiscountBanner } from '@/components/ui/discount-banner';
import { getDiscountConfigAction } from '@/app/actions';
import { DiscountConfig } from '@/lib/discount';
import { useLocation } from '@/hooks/use-location';

type SubscriptionDetails = {
  id: string;
  productId: string;
  status: string;
  amount: number;
  currency: string;
  recurringInterval: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  organizationId: string | null;
};

type SubscriptionDetailsResult = {
  hasSubscription: boolean;
  subscription?: SubscriptionDetails;
  error?: string;
  errorType?: 'CANCELED' | 'EXPIRED' | 'GENERAL';
};

interface PricingTableProps {
  subscriptionDetails: SubscriptionDetailsResult;
  user: any;
}

export default function PricingTable({ subscriptionDetails, user }: PricingTableProps) {
  const router = useRouter();
  const location = useLocation();

  const [discountConfig, setDiscountConfig] = useState<DiscountConfig>({ enabled: false });
  const [countdownTime, setCountdownTime] = useState<{ days: number; hours: number; minutes: number; seconds: number }>(
    { days: 0, hours: 23, minutes: 59, seconds: 59 },
  );

  useEffect(() => {
    const fetchDiscountConfig = async () => {
      try {
        const config = await getDiscountConfigAction();

        // Add original price if not already present (let edge config handle discount details)
        const isDevMode = config.dev || process.env.NODE_ENV === 'development';

        if ((config.enabled || isDevMode) && !config.originalPrice) {
          config.originalPrice = PRICING.PRO_MONTHLY;
        }
        setDiscountConfig(config);

        // Set initial countdown based on startsAt or expiresAt
        if (config.startsAt || config.expiresAt) {
          updateCountdown(config.startsAt, config.expiresAt);
        } else {
          // Default 24-hour countdown if no timing set
          const endTime = new Date();
          endTime.setHours(endTime.getHours() + 24);
          updateCountdown(undefined, endTime);
        }
      } catch (error) {
        console.error('Failed to fetch discount config:', error);
      }
    };

    const updateCountdown = (startsAt?: Date, expiresAt?: Date) => {
      const calculateTimeLeft = () => {
        const now = new Date().getTime();

        // Check if discount hasn't started yet
        if (startsAt && now < startsAt.getTime()) {
          const difference = startsAt.getTime() - now;
          const days = Math.floor(difference / (1000 * 60 * 60 * 24));
          const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((difference % (1000 * 60)) / 1000);
          setCountdownTime({ days, hours, minutes, seconds });
          return;
        }

        // Check if discount is active and count down to expiration
        if (expiresAt) {
          const difference = expiresAt.getTime() - now;
          if (difference > 0) {
            const days = Math.floor(difference / (1000 * 60 * 60 * 24));
            const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((difference % (1000 * 60)) / 1000);
            setCountdownTime({ days, hours, minutes, seconds });
          }
        }
      };

      calculateTimeLeft();
      const countdownInterval = setInterval(calculateTimeLeft, 1000);
      return () => clearInterval(countdownInterval);
    };

    fetchDiscountConfig();
  }, []);

  // Helper function to calculate discounted price
  const getDiscountedPrice = (originalPrice: number, isINR: boolean = false) => {
    const isDevMode = discountConfig.dev || process.env.NODE_ENV === 'development';
    const shouldApplyDiscount = isDevMode
      ? discountConfig.code && discountConfig.message
      : discountConfig.enabled && discountConfig.code && discountConfig.message;

    if (!shouldApplyDiscount) {
      return originalPrice;
    }

    // Use INR price directly if available
    if (isINR && discountConfig.inrPrice) {
      return discountConfig.inrPrice;
    }

    // Apply percentage discount
    if (discountConfig.percentage) {
      return Math.round(originalPrice - (originalPrice * discountConfig.percentage) / 100);
    }

    return originalPrice;
  };

  // Check if discount should be shown
  const shouldShowDiscount = () => {
    const isDevMode = discountConfig.dev || process.env.NODE_ENV === 'development';
    return isDevMode
      ? discountConfig.code && discountConfig.message && (discountConfig.percentage || discountConfig.inrPrice)
      : discountConfig.enabled &&
          discountConfig.code &&
          discountConfig.message &&
          (discountConfig.percentage || discountConfig.inrPrice);
  };

  const handleCheckout = async (productId: string, slug: string, paymentMethod?: 'dodo' | 'polar') => {
    if (!user) {
      router.push('/sign-up');
      return;
    }

    try {
      if (paymentMethod === 'dodo') {
        // DodoPayments checkout (one-time payment)
        router.push('/checkout');
      } else {
        await authClient.checkout({
          products: [productId],
          slug: slug,
        });
      }
    } catch (error) {
      console.error('Checkout failed:', error);
      toast.error('Something went wrong. Please try again.');
    }
  };

  const handleManageSubscription = async () => {
    try {
      const proSource = getProAccessSource();
      if (proSource === 'dodo') {
        // Use DodoPayments portal for DodoPayments users
        await betterauthClient.dodopayments.customer.portal();
      } else {
        // Use Polar portal for Polar subscribers
        await authClient.customer.portal();
      }
    } catch (error) {
      console.error('Failed to open customer portal:', error);
      toast.error('Failed to open subscription management');
    }
  };

  const STARTER_TIER = process.env.NEXT_PUBLIC_STARTER_TIER;
  const STARTER_SLUG = process.env.NEXT_PUBLIC_STARTER_SLUG;

  if (!STARTER_TIER || !STARTER_SLUG) {
    throw new Error('Missing required environment variables for Starter tier');
  }

  const isCurrentPlan = (tierProductId: string) => {
    return (
      subscriptionDetails.hasSubscription &&
      subscriptionDetails.subscription?.productId === tierProductId &&
      subscriptionDetails.subscription?.status === 'active'
    );
  };

  // Check if user has any Pro status (Polar or DodoPayments)
  const hasProAccess = () => {
    // Check Polar subscription
    const hasPolarSub = isCurrentPlan(STARTER_TIER);
    // Check DodoPayments Pro status
    const hasDodoProAccess = user?.isProUser && user?.proSource === 'dodo';

    return hasPolarSub || hasDodoProAccess;
  };

  // Get the source of Pro access for display
  const getProAccessSource = () => {
    if (isCurrentPlan(STARTER_TIER)) return 'polar';
    if (user?.proSource === 'dodo') return 'dodo';
    return null;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleDiscountClaim = (code: string) => {
    // Copy discount code to clipboard
    navigator.clipboard.writeText(code);
    toast.success(`Discount code "${code}" copied to clipboard!`);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Back to Home Link */}
      <div className="max-w-4xl mx-auto px-6 pt-6">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Back to Home
        </Link>
      </div>

      {/* Header */}
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-16">
        <div className="text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight font-be-vietnam-pro text-zinc-900 dark:text-zinc-100 mb-6 leading-tight">
            Pricing
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-lg font-medium font-be-vietnam-pro leading-relaxed">
            Choose the plan that works best for you
          </p>
          {!location.loading && location.isIndia && (
            <div className="mt-4">
              <Badge variant="secondary" className="px-3 py-1">
                🇮🇳 Introducing special India based pricing
              </Badge>
            </div>
          )}
        </div>
      </div>

      <DiscountBanner
        discountConfig={discountConfig}
        onClaim={handleDiscountClaim}
        className="max-w-[850px] mx-6 sm:mx-auto px-4 mb-8 flex"
      />

      {/* Pricing Cards */}
      <div className="max-w-4xl mx-auto px-6 pb-24">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Free Plan */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-10 relative hover:border-zinc-300/80 dark:hover:border-zinc-700/80 transition-colors duration-200">
            <div className="mb-10">
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-3 tracking-[-0.01em]">Free</h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-8 leading-relaxed">
                Get started with essential features
              </p>
              <div className="flex items-baseline mb-2">
                <span className="text-4xl font-light text-zinc-900 dark:text-zinc-100 tracking-tight">$0</span>
                <span className="text-zinc-400 dark:text-zinc-500 ml-2 text-sm">/month</span>
              </div>
            </div>

            <div className="mb-10">
              <ul className="space-y-4">
                <li className="flex items-center text-[15px]">
                  <div className="w-1 h-1 bg-zinc-300 dark:bg-zinc-600 rounded-full mr-4 flex-shrink-0"></div>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {SEARCH_LIMITS.DAILY_SEARCH_LIMIT} searches per day (other models)
                  </span>
                </li>
                <li className="flex items-center text-[15px]">
                  <div className="w-1 h-1 bg-zinc-300 dark:bg-zinc-600 rounded-full mr-4 flex-shrink-0"></div>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {SEARCH_LIMITS.EXTREME_SEARCH_LIMIT} extreme searches per month
                  </span>
                </li>
                <li className="flex items-center text-[15px]">
                  <div className="w-1 h-1 bg-zinc-300 dark:bg-zinc-600 rounded-full mr-4 flex-shrink-0"></div>
                  <span className="text-zinc-700 dark:text-zinc-300">Search history</span>
                </li>
                <li className="flex items-center text-[15px]">
                  <div className="w-1 h-1 bg-zinc-300 dark:bg-zinc-600 rounded-full mr-4 flex-shrink-0"></div>
                  <span className="text-zinc-700 dark:text-zinc-300">No Lookout access</span>
                </li>
              </ul>
            </div>

            {!subscriptionDetails.hasSubscription || subscriptionDetails.subscription?.status !== 'active' ? (
              <Button
                variant="outline"
                className="w-full h-9 border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-normal text-sm tracking-[-0.01em]"
                disabled
              >
                Current plan
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full h-9 border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-normal text-sm tracking-[-0.01em]"
                disabled
              >
                Free plan
              </Button>
            )}
          </div>

          {/* Pro Plan */}
          <div className="relative">
            {hasProAccess() && (
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
                <Badge className="bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 text-xs font-normal tracking-wide">
                  CURRENT PLAN
                </Badge>
              </div>
            )}
            {!hasProAccess() && shouldShowDiscount() && (
              <div className="absolute -top-4 right-4 z-10">
                <Badge className="bg-primary text-primary-foreground px-3 py-1 text-xs font-medium">
                  {discountConfig.percentage}% OFF
                </Badge>
              </div>
            )}

            <div className="bg-white dark:bg-zinc-900 border-[1.5px] border-black dark:border-white rounded-xl p-10 relative shadow-sm">
              <div className="mb-10">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 tracking-[-0.01em]">Scira Pro</h3>
                  <Badge
                    variant="secondary"
                    className="bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-normal px-2.5 py-1"
                  >
                    Popular
                  </Badge>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 text-sm mb-8 leading-relaxed">
                  Everything you need for unlimited usage
                </p>

                {/* Pricing Options for Indian Users */}
                {!location.loading && location.isIndia ? (
                  <div className="space-y-4 mb-6">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 border rounded-lg bg-background space-y-1">
                        <div>
                          {shouldShowDiscount() ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground line-through">
                                ₹{PRICING.PRO_MONTHLY_INR}
                              </span>
                              <span className="text-2xl font-light">
                                ₹{getDiscountedPrice(PRICING.PRO_MONTHLY_INR, true)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-2xl font-light">₹{PRICING.PRO_MONTHLY_INR}</span>
                          )}
                          <div className="text-xs text-muted-foreground">+18% GST</div>
                        </div>
                        <div className="text-xs text-muted-foreground">One-time</div>
                        <div className="text-xs text-foreground">1 month access</div>
                        <div className="mt-2 space-y-0.5">
                          <div className="text-[10px] text-muted-foreground font-medium">🇮🇳 Indian Payment</div>
                          <div className="text-[10px] text-muted-foreground">Card, UPI ID & QR available</div>
                        </div>
                      </div>
                      <div className="p-4 border rounded-lg bg-muted space-y-1">
                        {shouldShowDiscount() ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground line-through">${PRICING.PRO_MONTHLY}</span>
                            <span className="text-2xl font-light">${getDiscountedPrice(PRICING.PRO_MONTHLY)} USD</span>
                          </div>
                        ) : (
                          <div className="text-2xl font-light">${PRICING.PRO_MONTHLY} USD</div>
                        )}
                        <div className="text-xs text-muted-foreground">Monthly</div>
                        <div className="text-xs text-foreground">Recurring</div>
                        {shouldShowDiscount() && discountConfig.discountAvail && (
                          <div className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                            {discountConfig.discountAvail}
                          </div>
                        )}
                        <div className="mt-2 space-y-0.5">
                          <div className="text-[10px] text-muted-foreground font-medium">💳 Card Payment</div>
                          <div className="text-[10px] text-muted-foreground">Debit and credit both work</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">Choose your preferred payment method</p>
                  </div>
                ) : (
                  <div className="mb-6">
                    <div className="flex items-baseline mb-2">
                      {location.loading ? (
                        <div className="animate-pulse">
                          <div className="h-12 w-20 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
                        </div>
                      ) : shouldShowDiscount() ? (
                        <div className="flex items-baseline gap-3">
                          <span className="text-2xl font-light text-muted-foreground line-through">$15</span>
                          <span className="text-4xl font-light text-zinc-900 dark:text-zinc-100 tracking-tight">
                            ${getDiscountedPrice(PRICING.PRO_MONTHLY)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-4xl font-light text-zinc-900 dark:text-zinc-100 tracking-tight">$15</span>
                      )}
                      <span className="text-zinc-500 dark:text-zinc-400 ml-2 text-sm">/month</span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 tracking-wide">CANCEL ANYTIME</p>
                  </div>
                )}
              </div>

              <div className="mb-10">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-6 tracking-[-0.01em]">
                  Everything in Free, plus:
                </p>
                <ul className="space-y-4">
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">Unlimited searches</span>
                  </li>
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">All AI models</span>
                  </li>
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">PDF document analysis</span>
                  </li>
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">Priority support</span>
                  </li>
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">Early access to features</span>
                  </li>
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      Scira Lookout ({LOOKOUT_LIMITS.TOTAL_LOOKOUTS} automated searches)
                    </span>
                  </li>
                  <li className="flex items-center text-[15px]">
                    <div className="w-1 h-1 bg-black dark:bg-white rounded-full mr-4 flex-shrink-0"></div>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      Up to {LOOKOUT_LIMITS.DAILY_LOOKOUTS} daily lookouts
                    </span>
                  </li>
                </ul>
              </div>

              {hasProAccess() ? (
                <div className="space-y-4">
                  <Button
                    className="w-full h-9 bg-black dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black font-normal text-sm tracking-[-0.01em] transition-colors duration-200"
                    onClick={handleManageSubscription}
                  >
                    {getProAccessSource() === 'dodo' ? 'Manage payment' : 'Manage subscription'}
                  </Button>
                  {/* Show Polar subscription details */}
                  {subscriptionDetails.subscription && getProAccessSource() === 'polar' && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center leading-relaxed">
                      {subscriptionDetails.subscription.cancelAtPeriodEnd
                        ? `Expires ${formatDate(subscriptionDetails.subscription.currentPeriodEnd)}`
                        : `Renews ${formatDate(subscriptionDetails.subscription.currentPeriodEnd)}`}
                    </p>
                  )}
                  {/* Show DodoPayments details */}
                  {getProAccessSource() === 'dodo' && user?.expiresAt && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center leading-relaxed">
                      Pro access expires {formatDate(new Date(user.expiresAt))}
                    </p>
                  )}
                </div>
              ) : !location.loading && location.isIndia ? (
                hasProAccess() ? (
                  <div className="space-y-4">
                    <Button
                      className="w-full h-9 bg-black dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black font-normal text-sm tracking-[-0.01em] transition-colors duration-200"
                      onClick={handleManageSubscription}
                    >
                      {getProAccessSource() === 'dodo' ? 'Manage payment' : 'Manage subscription'}
                    </Button>
                    {/* Show Polar subscription details */}
                    {subscriptionDetails.subscription && getProAccessSource() === 'polar' && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center leading-relaxed">
                        {subscriptionDetails.subscription.cancelAtPeriodEnd
                          ? `Expires ${formatDate(subscriptionDetails.subscription.currentPeriodEnd)}`
                          : `Renews ${formatDate(subscriptionDetails.subscription.currentPeriodEnd)}`}
                      </p>
                    )}
                    {/* Show DodoPayments details */}
                    {getProAccessSource() === 'dodo' && user?.expiresAt && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center leading-relaxed">
                        Pro access expires {formatDate(new Date(user.expiresAt))}
                      </p>
                    )}
                  </div>
                ) : !user ? (
                  <Button
                    className="w-full h-9 bg-black dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black group font-normal text-sm tracking-[-0.01em] transition-all duration-200"
                    onClick={() => handleCheckout(STARTER_TIER, STARTER_SLUG)}
                  >
                    Sign up to get started
                    <ArrowRight className="w-3.5 h-3.5 ml-2 group-hover:translate-x-1 transition-transform duration-200" />
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground text-center font-medium">
                      Choose your preferred payment method:
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        className="w-full h-9 group font-normal text-sm tracking-[-0.01em] transition-all duration-200"
                        onClick={() => handleCheckout(STARTER_TIER, STARTER_SLUG, 'dodo')}
                      >
                        🇮🇳 Pay ₹{getDiscountedPrice(PRICING.PRO_MONTHLY_INR, true)} (1 month access)
                        <ArrowRight className="w-3.5 h-3.5 ml-2 group-hover:translate-x-1 transition-transform duration-200" />
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full h-9 group font-normal text-sm tracking-[-0.01em] transition-all duration-200"
                        onClick={() => handleCheckout(STARTER_TIER, STARTER_SLUG, 'polar')}
                      >
                        💳 Subscribe ${getDiscountedPrice(PRICING.PRO_MONTHLY)}/month
                        <ArrowRight className="w-3.5 h-3.5 ml-2 group-hover:translate-x-1 transition-transform duration-200" />
                      </Button>
                      {shouldShowDiscount() && discountConfig.discountAvail && (
                        <p className="text-xs text-green-600 dark:text-green-400 text-center mt-1 font-medium">
                          {discountConfig.discountAvail}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      Indian payment: One-time • Card payment: Recurring subscription
                    </p>
                  </div>
                )
              ) : (
                <Button
                  className="w-full h-9 bg-black dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black group font-normal text-sm tracking-[-0.01em] transition-all duration-200 disabled:opacity-50"
                  onClick={() => handleCheckout(STARTER_TIER, STARTER_SLUG)}
                  disabled={location.loading}
                >
                  {location.loading
                    ? 'Loading...'
                    : !user
                      ? 'Sign up to get started'
                      : 'Upgrade to Scira Pro ($15/month)'}
                  {!location.loading && (
                    <ArrowRight className="w-3.5 h-3.5 ml-2 group-hover:translate-x-1 transition-transform duration-200" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Student Discount */}
        <div className="max-w-2xl mx-auto bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 mt-12">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-black/10 dark:bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="h-5 w-5 text-black dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2 text-zinc-900 dark:text-zinc-100">Student Discount Available</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                Students can get the Pro plan for just $5/month (₹500/month). Email zaid@scira.ai with your student
                verification and a brief description of how you use Scira for your studies.
              </p>
              <a
                href="mailto:zaid@scira.ai?subject=Student%20Discount%20Request"
                className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-sm font-medium transition-colors"
              >
                Apply for Student Discount
              </a>
            </div>
          </div>
        </div>

        {/* Terms Notice */}
        <div className="text-center mt-16 mb-8">
          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-6 py-4 inline-block">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              By subscribing, you agree to our{' '}
              <Link
                href="/terms"
                className="text-black dark:text-white font-medium hover:underline underline-offset-4 transition-colors duration-200"
              >
                Terms of Service
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-12">
          <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
            Have questions?{' '}
            <a
              href="mailto:zaid@scira.ai"
              className="text-black dark:text-white hover:underline underline-offset-4 decoration-zinc-400 dark:decoration-zinc-600 transition-colors duration-200"
            >
              Get in touch
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
