'use strict';
var core = require('./core.js');
var path = require('path');
var yaml = require('js-yaml');
var fs = require('fs');
var inject = require('gulp-inject');
var bowerFiles = require('main-bower-files');
var _ = require('lodash');

module.exports = function (gulp, config, tasks) {
  var plConfig = yaml.safeLoad(
    fs.readFileSync(config.patternLab.configFile, 'utf8')
  );
  var plRoot = path.join(config.patternLab.configFile, '../..');
  var plSource = path.join(plRoot, plConfig.sourceDir);
  var plPublic = path.join(plRoot, plConfig.publicDir);
  var plMeta = path.join(plSource, '/_meta');
  var consolePath = path.join(plRoot, 'core/console');

  function plBuild(cb) {
    core.sh('php ' + consolePath +  ' --generate', true, function() {
      if (config.browserSync.enabled) {
        require('browser-sync').get('server').reload();
      }
      cb();
    });
  }

  gulp.task('pl', 'Compile Pattern Lab', plBuild);

  var watchedExtensions = config.patternLab.watchedExtensions.join(',');
  gulp.task('watch:pl', function () {
    var plGlob = path.normalize(plSource + '/**/*.{' + watchedExtensions + '}' );
    gulp.watch(plGlob, function(event) {
      console.log('File ' + path.relative(process.cwd(), event.path) + ' was ' + event.type + ', running tasks...');
      core.sh('php ' + consolePath +  ' --generate', false, function() {
        if (config.browserSync.enabled) {
          require('browser-sync').get('server').reload();
        }
      });
    });
  });

  // Begin `<link>` & `<script>` injecting code.
  // Will look for these HTML comments in `plSource/_meta/*.twig:
  // `<!-- inject:css -->`
  // `<!-- endinject -->`
  // `<!-- inject:js -->`
  // `<!-- endinject -->`
  // if CSS & JS compiling, ensure it's done before we inject PL
  var injectDeps = [];
  if (config.css.enabled) {
    injectDeps.push('css:full');
  }
  if (config.js.enabled) {
    injectDeps.push('js');
  }
  gulp.task('inject:pl', 'Inject Bower Components into Pattern Lab', injectDeps, function (done) {
    var sources = [];
    if (config.patternLab.injectBower) {
      sources = sources.concat(bowerFiles({
        includeDev: true
      }));
    }
    if (config.patternLab.injectFiles) {
      sources = sources.concat(config.patternLab.injectFiles);
    }
    sources = sources.concat(path.normalize(config.js.dest + '/*.js'));
    sources = sources.concat(path.normalize(config.css.dest + '/*.css'));

    gulp.src([
      '*.twig'
    ], {
      cwd: plMeta
    })
    .pipe(inject(gulp.src(sources, {read: false}), {
      relative: true,
      ignorePath: path.relative(plMeta, process.cwd()),
      // joining `../..` onto path change I'd have to do to go from plPublic directory to CWD
      addPrefix: path.join('../..', path.relative(plPublic, process.cwd()))
    }))
    .pipe(gulp.dest(plMeta))
    .on('end', function() {
      done();
    });

  });

  if (config.patternLab.injectBower) {
    gulp.task('watch:inject:pl', function () {
      gulp.watch('./bower.json', ['inject:pl']);
    });
    tasks.watch.push('watch:inject:pl');
  }// end `if (config.patternLab.injectBower)`

  var plFullDependencies = ['inject:pl'];
  if (config.icons.enabled) {
    plFullDependencies.push('icons');
  }

  if (config.patternLab.scssToJson) {
    // turns scss files full of variables into json files that PL can iterate on
    gulp.task('pl:scss-to-json', function (done) {
      config.patternLab.scssToJson.forEach(function(pair) {
        var scssVarList = _.filter(fs.readFileSync(pair.src, 'utf8').split('\n'), function(item) {
          return _.startsWith(item, pair.lineStartsWith);
        });
        // console.log(scssVarList, item.src);
        var varsAndValues = _.map(scssVarList, function(item) {
          // assuming `item` is `$color-gray: hsl(0, 0%, 50%); // main gray color`
          var x = item.split(':');
          var y = x[1].split(';');
          return {
            name: x[0].trim(), // i.e. $color-gray
            value: y[0].trim(), // i.e. hsl(0, 0%, 50%)
            comment: y[1].replace('//', '').trim() // any inline comment coming after, i.e. `// main gray color`
          };
        });

        if (! pair.allowVarValues) {
          varsAndValues = _.filter(varsAndValues, function(item) {
            return ! _.startsWith(item.value, '$');
          });
        }

        fs.writeFileSync(pair.dest, JSON.stringify({
          items: varsAndValues,
          meta: {
            description: 'To add to these items, use Sass variables that start with <code>' + pair.lineStartsWith + '</code> in <code>' + pair.src + '</code>'
          }
        }, null, '  '));

      });
      done();
    });
    plFullDependencies.push('pl:scss-to-json');

    gulp.task('watch:pl:scss-to-json', function() {
      var files = config.patternLab.scssToJson.map(function(file) {return file.src;});
      gulp.watch(files, ['pl:scss-to-json']);
    });
    tasks.watch.push('watch:pl:scss-to-json');
  }

  gulp.task('pl:full', false, plFullDependencies, plBuild);


  tasks.watch.push('watch:pl');
  tasks.compile.push('pl:full');

};
