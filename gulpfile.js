'use strict';
var gulp          = require('gulp');

// code style
var jscs          = require('gulp-jscs');
var jshint        = require('gulp-jshint');

// build
var babel         = require('gulp-babel');
var mocha         = require('gulp-mocha');
var webpack       = require('gulp-webpack');

// testing
var isparta       = require('isparta');
var istanbul      = require('gulp-istanbul');
var testServer    = require('./spec/testing-tools/mock-server');
var stubby        = require('gulp-stubby-server');
var proxyServer   = require('gulp-express');

var mockServer;
var stubbyServer;

// random
var open          = require('open');

gulp.task('lint', function() {
  return gulp.src(['lib/**/*.js', 'spec/**/*.js'])
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(jscs());
});

gulp.task('mock', function(cb) {
  mockServer = testServer.listen(1337);

  var options = { files: ['mocks/*.{json,yaml,js}'] };
  stubbyServer = stubby(options, cb);
});

gulp.task('test:tdd', function() {
  // swizzle require because it's simpler
  require('babel/register');
  return gulp.src(['spec/**/*.spec.js'])
    .pipe(mocha({
      reporter: 'min'
    }));
});

gulp.task('tdd', ['mock'], function() {
  gulp.start('test:tdd');
  gulp.watch(['lib/**/*.js', 'spec/**/*.spec.js'], ['test:tdd']);
});

gulp.task('test', ['mock'], function(done) {
  var testFile = process.env.TEST_RESULTS_DIR === undefined ?
                  'artifacts/test/test-results.xml' :
                  process.env.TEST_RESULTS_DIR + '/test-results.xml';
  var coverageDir = process.env.COVERAGE_DIR || 'artifacts/coverage';

  gulp.src(['lib/**/*.js'])
    .pipe(istanbul({
      instrumenter: isparta.Instrumenter
    }))
    .pipe(istanbul.hookRequire())
    .on('finish', function() {
      gulp.src(['spec/**/*.spec.js'])
        .pipe(mocha({
          reporter: 'spec'
        }))
        .pipe(istanbul.writeReports({
          dir: coverageDir,
          reporters: ['lcov', 'json', 'html', 'text']
        }))
        .on('end', function() {
          mockServer.close(done);
          stubbyServer.stop();
          if (process.env.OPEN) {
            open(__dirname + '/artifacts/coverage/index.html');
          }
        });
    });
});

gulp.task('build', ['build:web_min', 'build:server']);

var webpackConfig = {
  entry: './lib/elide.js',
  resolve: {
    extensions: ['', '.js']
  },
  output: {
    filename: 'web/elide.js',
    library: 'Elide',
    libraryTarget: 'umd'
  },
  module: {
    loaders: [
      {test: /\.js$/, exclude: [/node_modules/], loader: 'babel-loader'}
    ],
  },
  plugins: [],
  stats: {
    colors: true
  },
  devtool: 'source-map'
};

gulp.task('build:web_min', ['build:web_debug'], function() {
  var minConfig = Object.create(webpackConfig);
  minConfig.output.filename = 'web/elide.min.js';
  minConfig.plugins = [
    new webpack.webpack.optimize.UglifyJsPlugin()
  ];
  return gulp.src('./lib/elide.js')
    .pipe(webpack(minConfig))
    .pipe(gulp.dest('./build'));
});

gulp.task('build:web_debug', function() {
  return gulp.src('./lib/elide.js')
    .pipe(webpack(webpackConfig))
    .pipe(gulp.dest('./build'));
});

gulp.task('build:server', function() {
  return gulp.src('./lib/**/*.js')
    .pipe(babel())
    .pipe(gulp.dest('./build/node'));
});

gulp.task('proxy-server', ['build:web_debug'], function() {
  gulp.src('mocks/index.html')
    .pipe(gulp.dest('./build/web'));
  proxyServer.run(['spec/testing-tools/proxy-server.js']);
});
